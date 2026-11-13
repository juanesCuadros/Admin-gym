//! Cola de lo que la estación hizo y falta subir (`sync_outbox`).
//!
//! - Cada operación se encola en la misma transacción que el cambio local que representa.
//! - Se envía en orden. El identificador y la clave de idempotencia no cambian entre reintentos:
//!   si la respuesta se pierde, el reenvío vuelve como `duplicada` y no se repite nada.
//! - Nada se borra: ni lo aplicado, ni los errores (E-16).

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};

use crate::error::{ErrorApp, Resultado};
use crate::reloj::a_texto;

pub const TAMANO_LOTE: usize = 50;

/// Encola una operación. Debe llamarse dentro de la transacción del cambio local.
pub fn encolar(
    conn: &Connection,
    ahora: DateTime<Utc>,
    tipo: &str,
    staff_id: Option<&str>,
    depende_de: &[String],
    payload: &Value,
) -> Resultado<String> {
    let id = uuid::Uuid::new_v4().to_string();
    let ts = a_texto(ahora);
    conn.execute(
        "INSERT INTO sync_outbox (id, tipo, idempotency_key, staff_id, ocurrida_en, depende_de, payload, creada_en)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?5)",
        params![id, tipo, format!("gd-{id}"), staff_id, ts, json!(depende_de).to_string(), payload.to_string()],
    )?;
    Ok(id)
}

#[derive(Debug, Clone)]
pub struct OperacionEnviada {
    pub id: String,
    /// Tal como viaja a `POST /sync/push`.
    pub cuerpo: Value,
}

fn dependencias(texto: &str) -> Vec<String> {
    serde_json::from_str(texto).unwrap_or_default()
}

/// Toma el siguiente lote en orden y lo marca `enviando`.
///
/// Una operación cuya dependencia está en `error` (o retenida por otra en error) no se envía
/// suelta: queda `retenida` en la estación hasta que esa dependencia se resuelva.
pub fn tomar_lote(conn: &Connection, limite: usize) -> Resultado<Vec<OperacionEnviada>> {
    let tx = conn.unchecked_transaction()?;
    let candidatas: Vec<(String, String, String, Option<String>, String, String, String, String)> = {
        let mut stmt = tx.prepare(
            "SELECT id, tipo, idempotency_key, staff_id, ocurrida_en, depende_de, payload, estado
             FROM sync_outbox WHERE estado IN ('pendiente', 'retenida') ORDER BY secuencia",
        )?;
        let filas = stmt.query_map([], |f| {
            Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?, f.get(4)?, f.get(5)?, f.get(6)?, f.get(7)?))
        })?;
        filas.collect::<Result<_, _>>()?
    };

    let mut bloqueadas: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM sync_outbox WHERE estado = 'error'")?;
        let filas = stmt.query_map([], |f| f.get(0))?;
        filas.collect::<Result<_, _>>()?
    };

    let mut lote = Vec::new();
    for (id, tipo, clave, staff_id, ocurrida_en, depende_de, payload, estado) in candidatas {
        let deps = dependencias(&depende_de);
        if deps.iter().any(|d| bloqueadas.contains(d)) {
            bloqueadas.push(id.clone());
            if estado != "retenida" {
                tx.execute(
                    "UPDATE sync_outbox SET estado = 'retenida', ultimo_error_codigo = 'DEPENDENCIA_PENDIENTE',
                       ultimo_error_mensaje = 'Depende de una operación con error. Se enviará cuando esa se resuelva.'
                     WHERE id = ?1",
                    [&id],
                )?;
            }
            continue;
        }
        if lote.len() >= limite {
            // Lo que no cupo, y lo que dependa de ello, espera al siguiente lote: el orden se respeta.
            break;
        }
        tx.execute("UPDATE sync_outbox SET estado = 'enviando', intentos = intentos + 1 WHERE id = ?1", [&id])?;
        lote.push(OperacionEnviada {
            cuerpo: json!({
                "id": id, "tipo": tipo, "idempotency_key": clave, "ocurrida_en": ocurrida_en, "staff_id": staff_id,
                "depende_de": deps, "payload": serde_json::from_str::<Value>(&payload).unwrap_or(Value::Null),
            }),
            id,
        });
    }
    tx.commit()?;
    Ok(lote)
}

#[derive(Debug, Default, PartialEq)]
pub struct ResumenEnvio {
    pub resueltas: usize,
    pub por_revisar: usize,
    pub con_error: usize,
    pub retenidas: usize,
}

/// Guarda lo que respondió el servidor para un lote. Lo que no venga en la respuesta vuelve a `pendiente`.
pub fn aplicar_resultados(conn: &Connection, ahora: DateTime<Utc>, lote: &[OperacionEnviada], respuesta: &Value) -> Resultado<ResumenEnvio> {
    let resultados = respuesta["resultados"].as_array().ok_or_else(|| {
        ErrorApp::nuevo("RESPUESTA_INVALIDA", "El servidor respondió algo que esta versión de GymDesk no entiende. Actualiza la aplicación.")
    })?;
    let ts = a_texto(ahora);
    let mut resumen = ResumenEnvio::default();
    let tx = conn.unchecked_transaction()?;
    for r in resultados {
        let Some(id) = r["id"].as_str() else { continue };
        if !lote.iter().any(|o| o.id == id) {
            continue;
        }
        let resultado = r["resultado"].as_str().unwrap_or("");
        // Una duplicada vale lo que valió la primera vez.
        let efectivo = if resultado == "duplicada" { r["resultado_original"].as_str().unwrap_or("aplicada") } else { resultado };
        let (estado, resuelta) = match efectivo {
            "aplicada" => ("aplicada", true),
            "pendiente_revision" => ("pendiente_revision", true),
            "invalida" => ("error", false),
            "retenida" => ("retenida", false),
            _ => ("pendiente", false),
        };
        match estado {
            "aplicada" => resumen.resueltas += 1,
            "pendiente_revision" => resumen.por_revisar += 1,
            "error" => resumen.con_error += 1,
            "retenida" => resumen.retenidas += 1,
            _ => {}
        }
        let (codigo, mensaje) = match estado {
            "pendiente_revision" => (r["revision"]["motivo_codigo"].as_str(), r["revision"]["motivo"].as_str()),
            "error" | "retenida" => (r["codigo"].as_str(), r["mensaje"].as_str()),
            _ => (None, None),
        };
        tx.execute(
            "UPDATE sync_outbox SET estado = ?1, ultimo_error_codigo = ?2, ultimo_error_mensaje = ?3, resultado = ?4,
               resuelta_en = CASE WHEN ?5 THEN ?6 ELSE NULL END
             WHERE id = ?7 AND estado = 'enviando'",
            params![estado, codigo, mensaje, r.to_string(), resuelta, ts, id],
        )?;
    }
    for op in lote {
        tx.execute("UPDATE sync_outbox SET estado = 'pendiente' WHERE id = ?1 AND estado = 'enviando'", [&op.id])?;
    }
    if resumen.resueltas + resumen.por_revisar > 0 {
        tx.execute("UPDATE sync_estado SET ultimo_envio_ok = ?1 WHERE id = 1", [&ts])?;
    }
    tx.commit()?;
    Ok(resumen)
}

/// La red falló: el lote vuelve a `pendiente`, con el mismo id y la misma clave.
pub fn devolver_a_pendiente(conn: &Connection, lote: &[OperacionEnviada]) -> Resultado<()> {
    for op in lote {
        conn.execute("UPDATE sync_outbox SET estado = 'pendiente' WHERE id = ?1 AND estado = 'enviando'", [&op.id])?;
    }
    Ok(())
}

/// Al abrir la app: lo que quedó `enviando` (la app se cerró a mitad de envío) vuelve a `pendiente`.
/// Si el servidor ya lo había recibido, el reenvío vuelve como `duplicada`.
pub fn recuperar_enviando(conn: &Connection) -> Resultado<usize> {
    Ok(conn.execute("UPDATE sync_outbox SET estado = 'pendiente' WHERE estado = 'enviando'", [])?)
}

#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub struct ConteosCola {
    /// Pendientes de subir (incluye lo retenido y lo que se está enviando).
    pub por_enviar: i64,
    pub con_error: i64,
    pub por_revisar: i64,
    pub aplicadas: i64,
}

pub fn conteos(conn: &Connection) -> Resultado<ConteosCola> {
    Ok(conn.query_row(
        "SELECT coalesce(sum(estado IN ('pendiente','enviando','retenida')), 0), coalesce(sum(estado = 'error'), 0),
                coalesce(sum(estado = 'pendiente_revision'), 0), coalesce(sum(estado = 'aplicada'), 0)
         FROM sync_outbox",
        [],
        |f| Ok(ConteosCola { por_enviar: f.get(0)?, con_error: f.get(1)?, por_revisar: f.get(2)?, aplicadas: f.get(3)? }),
    )?)
}
