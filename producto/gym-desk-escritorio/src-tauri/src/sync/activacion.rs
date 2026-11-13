//! Activación de la estación: subdominio del gimnasio + código que generó el Jefe.

use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde_json::json;

use crate::auditoria::{self, Actor};
use crate::error::{ErrorApp, Resultado};
use crate::reloj::{a_texto, Reloj};
use crate::sync::transporte::{base_de_api, Metodo, Peticion, Transporte};

/// Acepta `powergym`, `PowerGym ` o la dirección completa pegada desde el navegador.
pub fn normalizar_subdominio(entrada: &str) -> Resultado<String> {
    let limpio = entrada.trim().to_lowercase();
    let limpio = limpio.trim_start_matches("https://").trim_start_matches("http://");
    let sub = limpio.split(['.', '/']).next().unwrap_or("").to_string();
    let valido = (2..=50).contains(&sub.len())
        && sub.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !sub.starts_with('-')
        && !sub.ends_with('-');
    if valido {
        Ok(sub)
    } else {
        Err(ErrorApp::nuevo(
            "SUBDOMINIO_INVALIDO",
            "Escribe el subdominio de tu gimnasio: lo que va antes de .gymdeskcolombia.com.",
        ))
    }
}

pub fn activar(
    base: &Mutex<Connection>,
    transporte: &dyn Transporte,
    reloj: &dyn Reloj,
    subdominio: &str,
    codigo: &str,
) -> Resultado<()> {
    let subdominio = normalizar_subdominio(subdominio)?;
    let codigo: String = codigo.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    if codigo.len() != 8 {
        return Err(ErrorApp::nuevo("CODIGO_INCOMPLETO", "El código de estación tiene 8 letras y números."));
    }
    {
        let conn = base.lock().unwrap_or_else(|e| e.into_inner());
        let activada: bool = conn.query_row("SELECT activada_en IS NOT NULL FROM estacion WHERE id = 1", [], |f| f.get(0))?;
        if activada {
            return Err(ErrorApp::nuevo("ESTACION_YA_ACTIVADA", "Esta estación ya está activada."));
        }
    }

    let api_base = base_de_api(&subdominio);
    let equipo = std::env::var("COMPUTERNAME").ok().filter(|n| !n.trim().is_empty());
    let cuerpo = json!({
        "subdominio": subdominio,
        "codigo": codigo,
        "nombre_equipo": equipo,
        "version_app": env!("CARGO_PKG_VERSION"),
    });
    // La base no queda tomada mientras se espera la red.
    let r = transporte
        .enviar(&api_base, Peticion { metodo: Metodo::Post, ruta: "/sync/activar", token: None, consulta: vec![], cuerpo: Some(&cuerpo) })
        .map_err(|e| e.a_error_app())?;

    let invalida = || ErrorApp::nuevo("RESPUESTA_INVALIDA", "El servidor respondió algo que esta versión de GymDesk no entiende. Actualiza la aplicación.");
    let token = r["device_token"].as_str().ok_or_else(invalida)?;
    let estacion_id = r["estacion_id"].as_str().ok_or_else(invalida)?;
    let estacion_nombre = r["nombre"].as_str().ok_or_else(invalida)?;
    let gimnasio_id = r["gimnasio"]["id"].as_str().ok_or_else(invalida)?;
    let gimnasio_nombre = r["gimnasio"]["nombre"].as_str().ok_or_else(invalida)?;

    let ahora = reloj.ahora();
    let conn = base.lock().unwrap_or_else(|e| e.into_inner());
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE estacion SET gimnasio_id = ?1, subdominio = ?2, gimnasio_nombre = ?3, activada_en = ?4,
           estacion_servidor_id = ?5, estacion_nombre = ?6, device_token = ?7, api_base = ?8, revocada_en = NULL
         WHERE id = 1",
        params![gimnasio_id, subdominio, gimnasio_nombre, a_texto(ahora), estacion_id, estacion_nombre, token, api_base],
    )?;
    auditoria::registrar(
        &tx,
        ahora,
        Actor::sistema(),
        "ACTIVAR_ESTACION",
        "estacion",
        Some(estacion_id),
        &json!({ "subdominio": subdominio, "estacion": estacion_nombre, "equipo": equipo }),
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn el_subdominio_se_acepta_como_lo_escriba_la_persona() {
        for entrada in ["powergym", "  PowerGym ", "powergym.gymdeskcolombia.com", "https://powergym.gymdeskcolombia.com/login"] {
            assert_eq!(normalizar_subdominio(entrada).unwrap(), "powergym", "{entrada}");
        }
        assert_eq!(normalizar_subdominio("gym-norte-2").unwrap(), "gym-norte-2");
    }

    #[test]
    fn un_subdominio_imposible_se_rechaza_antes_de_salir_a_la_red() {
        for entrada in ["", "a", "-gym", "gym-", "mi gimnasio", "gym_1", "ñandú"] {
            assert_eq!(normalizar_subdominio(entrada).unwrap_err().codigo, "SUBDOMINIO_INVALIDO", "{entrada}");
        }
    }
}
