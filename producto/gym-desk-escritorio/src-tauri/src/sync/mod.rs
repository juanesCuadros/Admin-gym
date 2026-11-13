//! Sincronización de la estación con el servidor del gimnasio.
//!
//! La estación trabaja contra su base local; lo que hace queda en una cola (`sync_outbox`) que se
//! sube cuando hay red, y lo que cambia en el servidor se descarga por rondas. El servidor es la
//! autoridad: valida todo lo que recibe (ver `docs/ALCANCE_APP_ESCRITORIO.md`).

pub mod suscripcion;
pub mod transporte;

pub mod activacion;
pub mod descarga;
pub mod ingreso;
pub mod motor;
pub mod outbox;

#[cfg(test)]
mod pruebas_descarga;
#[cfg(test)]
mod pruebas_envio;
#[cfg(test)]
pub mod pruebas_util;

use chrono::{DateTime, Utc};
use rusqlite::Connection;

use crate::error::{ErrorApp, Resultado};

/// Activada, sin revocar y con el servicio del gimnasio al día: condición para iniciar sesión.
pub fn exigir_operable(conn: &Connection, ahora: DateTime<Utc>) -> Resultado<()> {
    let (activada, revocada): (bool, bool) =
        conn.query_row("SELECT activada_en IS NOT NULL, revocada_en IS NOT NULL FROM estacion WHERE id = 1", [], |f| {
            Ok((f.get(0)?, f.get(1)?))
        })?;
    if !activada {
        return Err(ErrorApp::nuevo("ESTACION_SIN_ACTIVAR", "Esta estación aún no está activada."));
    }
    if revocada {
        return Err(ErrorApp::nuevo("ESTACION_REVOCADA", "El Jefe del gimnasio revocó esta estación."));
    }
    let s = suscripcion::estado_actual(conn, crate::reloj::fecha_negocio(ahora))?;
    if s.estado == "bloqueado" {
        return Err(ErrorApp::con_detalles(
            "GIMNASIO_SUSPENDIDO",
            "El servicio del gimnasio no está disponible.",
            serde_json::json!({ "motivo": s.motivo_bloqueo }),
        ));
    }
    Ok(())
}
