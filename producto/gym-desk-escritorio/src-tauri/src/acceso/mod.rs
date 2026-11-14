//! Control de ingreso de la estación. Decide con los datos locales, con red o sin ella, y deja
//! cada intento en la cola para que suba al servidor.

pub mod regla;
pub mod registro;

#[cfg(test)]
mod pruebas_registro;
#[cfg(test)]
mod prueba_comparativa;
