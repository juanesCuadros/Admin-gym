//! Puerta o torniquete. La estación abre la cerradura (imán, portón, torniquete) con un relé de la red local
//! cuando el ingreso queda verde, y también a mano desde Ingreso.
//!
//! - `shelly`: relé Wi-Fi Shelly (Gen1 y Gen2+). Se escribe la IP del relé; se prende y se apaga solo a los
//!   `segundos` configurados, así la puerta nunca queda abierta si el PC se cae a mitad.
//! - `url`: cualquier controladora que abra con una dirección web (GET), p. ej. un relé Sonoff en modo DIY o
//!   la API de una controladora de acceso.
//!
//! Funciona sin internet: el relé está en la red del gimnasio.

use std::time::Duration;

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auditoria::{self, Actor};
use crate::error::{ErrorApp, Resultado};
use crate::sesion::UsuarioSesion;

pub const TIPOS: &[(&str, &str)] = &[
    ("ninguna", "Sin puerta automática"),
    ("shelly", "Relé Wi-Fi Shelly"),
    ("url", "Otra controladora (dirección web)"),
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConfigPuerta {
    pub tipo: String,
    pub direccion: Option<String>,
    pub segundos: u32,
}

pub fn leer(conn: &Connection) -> Resultado<ConfigPuerta> {
    Ok(conn.query_row("SELECT puerta_tipo, puerta_direccion, puerta_segundos FROM estacion WHERE id = 1", [], |f| {
        Ok(ConfigPuerta { tipo: f.get(0)?, direccion: f.get(1)?, segundos: f.get::<_, i64>(2)?.clamp(1, 30) as u32 })
    })?)
}

fn host_valido(h: &str) -> bool {
    !h.is_empty() && h.len() <= 100 && h.chars().all(|c| c.is_ascii_alphanumeric() || ".-:".contains(c))
}

/// Revisa y normaliza lo que escribió el Jefe.
pub fn validar(cfg: &ConfigPuerta) -> Resultado<ConfigPuerta> {
    if !TIPOS.iter().any(|(t, _)| *t == cfg.tipo) {
        return Err(ErrorApp::nuevo("DATOS_INVALIDOS", "Ese tipo de puerta no existe."));
    }
    if !(1..=30).contains(&cfg.segundos) {
        return Err(ErrorApp::nuevo("DATOS_INVALIDOS", "El tiempo de apertura va de 1 a 30 segundos."));
    }
    let direccion = cfg.direccion.as_deref().map(str::trim).filter(|d| !d.is_empty()).map(str::to_string);
    let direccion = match cfg.tipo.as_str() {
        "ninguna" => None,
        "shelly" => {
            let h = direccion.ok_or_else(|| ErrorApp::nuevo("DATOS_INVALIDOS", "Escribe la IP del relé, p. ej. 192.168.1.50."))?;
            let h = h.trim_start_matches("http://").trim_end_matches('/').to_string();
            if !host_valido(&h) {
                return Err(ErrorApp::nuevo("DATOS_INVALIDOS", "La IP del relé no es válida. Ejemplo: 192.168.1.50."));
            }
            Some(h)
        }
        _ => {
            let u = direccion.ok_or_else(|| ErrorApp::nuevo("DATOS_INVALIDOS", "Escribe la dirección que abre la puerta."))?;
            if !(u.starts_with("http://") || u.starts_with("https://")) || u.len() > 500 || u.chars().any(char::is_whitespace) {
                return Err(ErrorApp::nuevo("DATOS_INVALIDOS", "La dirección debe empezar por http:// y no tener espacios."));
            }
            Some(u)
        }
    };
    Ok(ConfigPuerta { tipo: cfg.tipo.clone(), direccion, segundos: cfg.segundos })
}

pub fn configurar(conn: &Connection, ahora: DateTime<Utc>, usuario: &UsuarioSesion, cfg: &ConfigPuerta) -> Resultado<ConfigPuerta> {
    if usuario.rol != "jefe" {
        return Err(ErrorApp::nuevo("PERMISO_DENEGADO", "Solo el Jefe configura la puerta de la estación."));
    }
    let cfg = validar(cfg)?;
    conn.execute(
        "UPDATE estacion SET puerta_tipo = ?1, puerta_direccion = ?2, puerta_segundos = ?3 WHERE id = 1",
        rusqlite::params![cfg.tipo, cfg.direccion, cfg.segundos],
    )?;
    auditoria::registrar(conn, ahora, Actor::persona(&usuario.id, &usuario.nombre), "CONFIGURAR_PUERTA", "estacion", None,
        &json!({ "tipo": cfg.tipo, "direccion": cfg.direccion, "segundos": cfg.segundos }))?;
    Ok(cfg)
}

/// Direcciones a llamar, en orden: Shelly Gen2+ primero y, si no la entiende, Gen1.
pub fn direcciones(cfg: &ConfigPuerta) -> Vec<String> {
    let Some(d) = cfg.direccion.as_deref() else { return vec![] };
    match cfg.tipo.as_str() {
        "shelly" => vec![
            format!("http://{d}/rpc/Switch.Set?id=0&on=true&toggle_after={}", cfg.segundos),
            format!("http://{d}/relay/0?turn=on&timer={}", cfg.segundos),
        ],
        "url" => vec![d.to_string()],
        _ => vec![],
    }
}

/// Abre la puerta. Tarda como mucho unos segundos; llamarla fuera del hilo de la pantalla.
pub fn abrir(cfg: &ConfigPuerta) -> Resultado<()> {
    let urls = direcciones(cfg);
    if urls.is_empty() {
        return Err(ErrorApp::nuevo("PUERTA_SIN_CONFIGURAR", "Esta estación no tiene puerta configurada."));
    }
    let agente = ureq::AgentBuilder::new().timeout(Duration::from_secs(4)).build();
    let mut ultimo = String::new();
    for url in urls {
        match agente.get(&url).call() {
            Ok(_) => return Ok(()),
            // El Shelly Gen1 no conoce /rpc: responde 404 y se prueba la otra.
            Err(ureq::Error::Status(c, _)) => ultimo = format!("respondió {c}"),
            Err(e) => {
                ultimo = e.to_string();
                break;
            }
        }
    }
    Err(ErrorApp::nuevo("PUERTA_NO_RESPONDE", &format!("La puerta no respondió ({ultimo}). Revisa que el relé esté prendido y en la misma red.")))
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn cfg(tipo: &str, d: Option<&str>, s: u32) -> ConfigPuerta {
        ConfigPuerta { tipo: tipo.into(), direccion: d.map(Into::into), segundos: s }
    }

    #[test]
    fn valida_y_normaliza() {
        assert_eq!(validar(&cfg("shelly", Some(" http://192.168.1.50/ "), 3)).unwrap().direccion.as_deref(), Some("192.168.1.50"));
        assert!(validar(&cfg("shelly", Some("192.168.1.50/x?y"), 3)).is_err());
        assert!(validar(&cfg("shelly", None, 3)).is_err());
        assert!(validar(&cfg("url", Some("ftp://x"), 3)).is_err());
        assert!(validar(&cfg("url", Some("http://10.0.0.2/abrir"), 3)).is_ok());
        assert!(validar(&cfg("shelly", Some("10.0.0.2"), 0)).is_err());
        assert!(validar(&cfg("otra", None, 3)).is_err());
        assert_eq!(validar(&cfg("ninguna", Some("algo"), 3)).unwrap().direccion, None);
    }

    #[test]
    fn shelly_prueba_gen2_y_luego_gen1() {
        let d = direcciones(&cfg("shelly", Some("192.168.1.50"), 5));
        assert_eq!(d, vec![
            "http://192.168.1.50/rpc/Switch.Set?id=0&on=true&toggle_after=5".to_string(),
            "http://192.168.1.50/relay/0?turn=on&timer=5".to_string(),
        ]);
        assert!(direcciones(&cfg("ninguna", None, 3)).is_empty());
    }
}
