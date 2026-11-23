//! Huella (fase 4, E-06, E-10 y E-43). Un solo flujo para cualquier lector: la app trabaja contra el trait
//! `LectorHuella` y cada marca es una pieza aparte que se elige en la configuración de la estación.
//!
//! - **Captura y comparación en el equipo**, con red o sin ella: las plantillas viven en la base cifrada.
//! - Al registrar una huella, la plantilla también sube al servidor (`huella_enrolar`), que la guarda cifrada.
//! - Lectores: `digitalpersona` (U.are.U 4000B, 4500, 5x00, con el kit oficial de HID) y `simulado`, para
//!   probar el flujo completo sin el aparato. El simulado se marca como de pruebas en pantalla.

pub mod digitalpersona;
pub mod simulado;

use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::json;

use crate::auditoria::{self, Actor};
use crate::error::{ErrorApp, Resultado};
use crate::reloj::a_texto;
use crate::sesion::UsuarioSesion;
use crate::sync::outbox;

/// Muestras que pide el registro de una huella (el kit de DigitalPersona necesita varias del mismo dedo).
pub const MUESTRAS_REGISTRO: usize = 4;

pub trait LectorHuella: Send {
    /// ansi378 | iso19794 | simulado
    fn formato(&self) -> &'static str;
    /// Espera el dedo y devuelve la muestra lista para comparar. `simulada`: lo que escribió quien prueba.
    fn capturar(&self, espera_ms: u32, simulada: Option<&str>) -> Resultado<Vec<u8>>;
    /// Une varias muestras del mismo dedo en una plantilla para guardar.
    fn plantilla(&self, muestras: &[Vec<u8>]) -> Resultado<Vec<u8>>;
    /// Busca la muestra entre las plantillas guardadas. Devuelve la posición de la que coincide.
    fn identificar(&self, muestra: &[u8], plantillas: &[Vec<u8>]) -> Resultado<Option<usize>>;
}

pub const LECTORES: &[(&str, &str)] = &[
    ("ninguno", "Sin lector de huella"),
    ("digitalpersona", "DigitalPersona U.are.U (4000B, 4500, 5x00)"),
    ("simulado", "Simulado (solo para pruebas)"),
];

pub fn crear(nombre: &str) -> Resultado<Box<dyn LectorHuella>> {
    match nombre {
        "digitalpersona" => Ok(Box::new(digitalpersona::DigitalPersona::cargar()?)),
        "simulado" => Ok(Box::new(simulado::Simulado)),
        _ => Err(ErrorApp::nuevo("SIN_LECTOR", "Esta estación no tiene lector de huella configurado. El Jefe lo elige en Equipo.")),
    }
}

pub fn lector_configurado(conn: &Connection) -> Resultado<String> {
    Ok(conn.query_row("SELECT lector_huella FROM estacion WHERE id = 1", [], |f| f.get(0))?)
}

pub fn configurar(conn: &Connection, ahora: DateTime<Utc>, usuario: &UsuarioSesion, lector: &str) -> Resultado<()> {
    if usuario.rol != "jefe" {
        return Err(ErrorApp::nuevo("PERMISO_DENEGADO", "Solo el Jefe cambia el lector de huella de la estación."));
    }
    if !LECTORES.iter().any(|(n, _)| *n == lector) {
        return Err(ErrorApp::nuevo("DATOS_INVALIDOS", "Ese lector no existe."));
    }
    conn.execute("UPDATE estacion SET lector_huella = ?1 WHERE id = 1", [lector])?;
    auditoria::registrar(conn, ahora, Actor::persona(&usuario.id, &usuario.nombre), "CONFIGURAR_LECTOR_HUELLA", "estacion", None, &json!({ "lector": lector }))?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
pub struct HuellaRegistrada {
    pub deportista_id: String,
    pub dedo: String,
    pub formato: String,
}

pub const DEDOS: &[&str] = &[
    "indice_derecho", "pulgar_derecho", "medio_derecho", "anular_derecho", "menique_derecho",
    "indice_izquierdo", "pulgar_izquierdo", "medio_izquierdo", "anular_izquierdo", "menique_izquierdo",
];

/// Guarda la plantilla en la estación (reemplaza la del mismo dedo) y la encola para el servidor.
pub fn guardar(
    conn: &Connection,
    ahora: DateTime<Utc>,
    usuario: &UsuarioSesion,
    deportista_id: &str,
    dedo: &str,
    formato: &str,
    plantilla: &[u8],
) -> Resultado<HuellaRegistrada> {
    if !crate::sync::clientes::puede_registrar(conn, usuario)? {
        return Err(ErrorApp::nuevo("PERMISO_DENEGADO", "No tienes permiso para registrar huellas. Pídeselo al Jefe."));
    }
    if !DEDOS.contains(&dedo) {
        return Err(ErrorApp::nuevo("DATOS_INVALIDOS", "Elige el dedo."));
    }
    let existe: Option<String> =
        conn.query_row("SELECT nombre FROM deportistas WHERE id = ?1 AND eliminado = 0", [deportista_id], |f| f.get(0)).optional()?;
    let Some(nombre) = existe else {
        return Err(ErrorApp::nuevo("CLIENTE_NO_ENCONTRADO", "Ese cliente no está en esta estación."));
    };
    let tx = conn.unchecked_transaction()?;
    let id = outbox::encolar(
        &tx,
        ahora,
        "huella_enrolar",
        Some(&usuario.id),
        &[],
        &json!({ "deportista_id": deportista_id, "dedo": dedo, "formato": formato, "template_base64": STANDARD.encode(plantilla) }),
    )?;
    tx.execute(
        "INSERT INTO huellas (deportista_id, dedo, formato, plantilla, registrada_en, operacion_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(deportista_id, dedo) DO UPDATE SET formato = excluded.formato, plantilla = excluded.plantilla,
           registrada_en = excluded.registrada_en, operacion_id = excluded.operacion_id",
        params![deportista_id, dedo, formato, plantilla, a_texto(ahora), id],
    )?;
    auditoria::registrar(
        &tx,
        ahora,
        Actor::persona(&usuario.id, &usuario.nombre),
        "ENROLAR_HUELLA",
        "huellas",
        Some(deportista_id),
        &json!({ "dedo": dedo, "formato": formato, "cliente": nombre }),
    )?;
    tx.commit()?;
    Ok(HuellaRegistrada { deportista_id: deportista_id.into(), dedo: dedo.into(), formato: formato.into() })
}

/// Plantillas guardadas del formato del lector: (deportista, plantilla).
pub fn plantillas(conn: &Connection, formato: &str) -> Resultado<Vec<(String, Vec<u8>)>> {
    let mut stmt = conn.prepare(
        "SELECT h.deportista_id, h.plantilla FROM huellas h JOIN deportistas d ON d.id = h.deportista_id
         WHERE h.formato = ?1 AND d.eliminado = 0 ORDER BY h.deportista_id, h.dedo",
    )?;
    let filas = stmt.query_map([formato], |f| Ok((f.get(0)?, f.get(1)?)))?;
    Ok(filas.collect::<Result<_, _>>()?)
}

/// Dedos registrados de un cliente.
pub fn dedos_de(conn: &Connection, deportista_id: &str) -> Resultado<Vec<String>> {
    let mut stmt = conn.prepare("SELECT dedo FROM huellas WHERE deportista_id = ?1 ORDER BY dedo")?;
    let filas = stmt.query_map([deportista_id], |f| f.get(0))?;
    Ok(filas.collect::<Result<_, _>>()?)
}

pub fn a_base64(datos: &[u8]) -> String {
    STANDARD.encode(datos)
}

pub fn de_base64(texto: &str) -> Resultado<Vec<u8>> {
    STANDARD.decode(texto).map_err(|_| ErrorApp::nuevo("HUELLA_INVALIDA", "La huella leída no es válida. Vuelve a capturarla."))
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db::pruebas::base_temporal;
    use crate::sync::descarga::aplicar_pagina;
    use crate::sync::pruebas_util::{fila_gimnasio, pagina, ANA};

    fn ahora() -> DateTime<Utc> {
        "2026-11-12T15:00:00Z".parse().unwrap()
    }

    #[test]
    fn registrar_e_identificar_con_el_lector_simulado() {
        let (_d, conn) = base_temporal();
        let cambios = json!({
            "gimnasio": [fila_gimnasio()],
            "deportistas": [
                { "id": "luis", "tipo_documento": "CC", "documento": "1001", "nombre": "Luis", "activo": true, "eliminado": false },
                { "id": "ana", "tipo_documento": "CC", "documento": "1002", "nombre": "Ana", "activo": true, "eliminado": false }
            ],
        });
        aplicar_pagina(&conn, ahora(), &pagina("c1", false, cambios)).unwrap();
        let jefe = UsuarioSesion { id: ANA.into(), nombre: "Jefe".into(), correo: "j@g.co".into(), rol: "jefe".into(), tiene_pin: true };
        assert_eq!(lector_configurado(&conn).unwrap(), "ninguno");
        configurar(&conn, ahora(), &jefe, "simulado").unwrap();
        let lector = crear(&lector_configurado(&conn).unwrap()).unwrap();

        let muestras: Vec<Vec<u8>> = (0..MUESTRAS_REGISTRO).map(|_| lector.capturar(1000, Some("luis-indice")).unwrap()).collect();
        let p = lector.plantilla(&muestras).unwrap();
        guardar(&conn, ahora(), &jefe, "luis", "indice_derecho", lector.formato(), &p).unwrap();
        let p2 = lector.plantilla(&[lector.capturar(1000, Some("ana-pulgar")).unwrap()]).unwrap();
        guardar(&conn, ahora(), &jefe, "ana", "pulgar_derecho", lector.formato(), &p2).unwrap();

        let guardadas = plantillas(&conn, "simulado").unwrap();
        let solo: Vec<Vec<u8>> = guardadas.iter().map(|(_, p)| p.clone()).collect();
        let i = lector.identificar(&lector.capturar(1000, Some("ana-pulgar")).unwrap(), &solo).unwrap().unwrap();
        assert_eq!(guardadas[i].0, "ana");
        assert!(lector.identificar(&lector.capturar(1000, Some("nadie")).unwrap(), &solo).unwrap().is_none());

        // Muestras de dedos distintos no forman una plantilla.
        assert!(lector.plantilla(&[b"SIM:a".to_vec(), b"SIM:b".to_vec()]).is_err());
        // La plantilla sube al servidor por la cola.
        let tipo: String = conn.query_row("SELECT tipo FROM sync_outbox WHERE tipo = 'huella_enrolar' LIMIT 1", [], |f| f.get(0)).unwrap();
        assert_eq!(tipo, "huella_enrolar");
        // Solo el Jefe elige el lector.
        let recepcion = UsuarioSesion { rol: "recepcionista".into(), ..jefe.clone() };
        assert_eq!(configurar(&conn, ahora(), &recepcion, "ninguno").unwrap_err().codigo, "PERMISO_DENEGADO");
        assert_eq!(guardar(&conn, ahora(), &recepcion, "luis", "indice_derecho", "simulado", &p).unwrap_err().codigo, "PERMISO_DENEGADO");
    }
}
