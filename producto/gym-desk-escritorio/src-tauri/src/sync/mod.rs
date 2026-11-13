//! Sincronización de la estación con el servidor del gimnasio.
//!
//! La estación trabaja contra su base local; lo que hace queda en una cola (`sync_outbox`) que se
//! sube cuando hay red, y lo que cambia en el servidor se descarga por rondas. El servidor es la
//! autoridad: valida todo lo que recibe (ver `docs/ALCANCE_APP_ESCRITORIO.md`).

pub mod suscripcion;
pub mod transporte;

pub mod activacion;
pub mod descarga;

#[cfg(test)]
mod pruebas_descarga;
#[cfg(test)]
pub mod pruebas_util;
