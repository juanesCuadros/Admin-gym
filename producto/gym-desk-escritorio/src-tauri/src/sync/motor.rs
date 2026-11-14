//! Motor de sincronización: sube lo pendiente y después descarga lo que cambió.
//!
//! Primero se envía y después se descarga, y el envío no depende de que el gimnasio esté al día:
//! lo ya cobrado sin red se sube aunque el servicio esté bloqueado (E-18).

use std::sync::Mutex;
use std::time::Duration;

use rusqlite::Connection;
use serde_json::json;

use crate::error::ErrorApp;
use crate::reloj::{a_texto, Reloj};
use crate::sync::descarga::{self, credenciales, ResultadoDescarga};
use crate::sync::outbox::{self, ResumenEnvio, TAMANO_LOTE};
use crate::sync::transporte::{ErrorTransporte, Metodo, Peticion, Transporte};

fn local(e: ErrorApp) -> ErrorTransporte {
    ErrorTransporte::Servidor { status: 0, codigo: e.codigo, mensaje: e.mensaje, detalles: e.detalles }
}

/// Sube todo lo pendiente, por lotes y en orden. Si la red falla, lo que iba en camino vuelve a
/// `pendiente` y se devuelve el error para reintentar más tarde.
pub fn enviar_pendientes(base: &Mutex<Connection>, transporte: &dyn Transporte, reloj: &dyn Reloj) -> Result<ResumenEnvio, ErrorTransporte> {
    let mut total = ResumenEnvio::default();
    loop {
        let (cred, lote) = {
            let conn = base.lock().unwrap_or_else(|e| e.into_inner());
            let Some(cred) = credenciales(&conn).map_err(local)? else { return Ok(total) };
            (cred, outbox::tomar_lote(&conn, TAMANO_LOTE).map_err(local)?)
        };
        if lote.is_empty() {
            return Ok(total);
        }
        // Con el reloj del equipo al enviar, el servidor mide el desfase y corrige la hora de los ingresos.
        let cuerpo = json!({
            "operaciones": lote.iter().map(|o| o.cuerpo.clone()).collect::<Vec<_>>(),
            "estacion_ahora": a_texto(reloj.ahora()),
        });
        let respuesta = transporte.enviar(
            &cred.api_base,
            Peticion { metodo: Metodo::Post, ruta: "/sync/push", token: Some(&cred.token), consulta: vec![], cuerpo: Some(&cuerpo) },
        );

        let conn = base.lock().unwrap_or_else(|e| e.into_inner());
        match respuesta {
            Ok(r) => {
                let resumen = outbox::aplicar_resultados(&conn, reloj.ahora(), &lote, &r).map_err(local)?;
                let avanzo = resumen.resueltas + resumen.por_revisar + resumen.con_error > 0;
                total.resueltas += resumen.resueltas;
                total.por_revisar += resumen.por_revisar;
                total.con_error += resumen.con_error;
                total.retenidas += resumen.retenidas;
                // Si el lote entero volvió retenido, insistir ahora no cambia nada.
                if !avanzo {
                    return Ok(total);
                }
            }
            Err(e) => {
                outbox::devolver_a_pendiente(&conn, &lote).map_err(local)?;
                if matches!(&e, ErrorTransporte::Servidor { codigo, .. } if codigo == "ESTACION_REVOCADA") {
                    conn.execute("UPDATE estacion SET revocada_en = ?1 WHERE id = 1 AND revocada_en IS NULL", [a_texto(reloj.ahora())])
                        .map_err(|e| local(e.into()))?;
                    return Ok(total);
                }
                return Err(e);
            }
        }
    }
}

#[derive(Debug, PartialEq)]
pub struct ResultadoCiclo {
    pub envio: ResumenEnvio,
    pub descarga: ResultadoDescarga,
}

/// Un ciclo completo: enviar y descargar.
pub fn ciclo(base: &Mutex<Connection>, transporte: &dyn Transporte, reloj: &dyn Reloj) -> Result<ResultadoCiclo, ErrorTransporte> {
    let envio = enviar_pendientes(base, transporte, reloj)?;
    let descarga = descarga::descargar(base, transporte, reloj)?;
    Ok(ResultadoCiclo { envio, descarga })
}

/// Cada cuánto se sincroniza cuando todo va bien.
pub const INTERVALO_NORMAL: Duration = Duration::from_secs(30);
const ESPERA_MINIMA: Duration = Duration::from_secs(5);
const ESPERA_MAXIMA: Duration = Duration::from_secs(300);

/// Espera creciente tras cada fallo seguido: 5 s, 10 s, 20 s… hasta 5 min. Un éxito la reinicia.
#[derive(Default)]
pub struct Espera {
    fallos_seguidos: u32,
}

impl Espera {
    pub fn siguiente(&mut self, exito: bool) -> Duration {
        if exito {
            self.fallos_seguidos = 0;
            return INTERVALO_NORMAL;
        }
        self.fallos_seguidos = self.fallos_seguidos.saturating_add(1);
        let factor = 1u64 << (self.fallos_seguidos - 1).min(10);
        ESPERA_MINIMA.saturating_mul(factor as u32).min(ESPERA_MAXIMA)
    }
}
