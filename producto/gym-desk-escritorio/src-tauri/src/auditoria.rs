//! Auditoría local: solo inserción, con cadena de hash SHA-256.
//! Se escribe en la misma transacción que el cambio que registra.
//! Nunca guarda contraseñas, PIN ni tokens.

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::Resultado;
use crate::reloj::a_texto;
use crate::sync::outbox;

/// Eventos de la estación que se suben a la auditoría del gimnasio (E-17). Deben coincidir con los
/// que acepta el servidor en el tipo `auditoria_estacion`.
pub const ACCIONES_QUE_SUBEN: &[&str] = &[
    "CREAR_BASE_LOCAL", "ACTIVAR_ESTACION", "INICIAR_SESION", "INGRESO_FALLIDO", "BLOQUEAR_SESION",
    "DESBLOQUEAR_SESION", "CERRAR_SESION", "CREAR_PIN", "CAMBIAR_PIN", "INVALIDAR_CREDENCIAL",
];

#[derive(Clone, Copy)]
pub struct Actor<'a> {
    pub id: Option<&'a str>,
    pub nombre: Option<&'a str>,
}

impl<'a> Actor<'a> {
    pub fn sistema() -> Self {
        Actor { id: None, nombre: Some("Sistema") }
    }

    pub fn persona(id: &'a str, nombre: &'a str) -> Self {
        Actor { id: Some(id), nombre: Some(nombre) }
    }
}

/// Campos que jamás se guardan, aunque alguien los pase por error.
const CLAVES_PROHIBIDAS: &[&str] = &["password", "contrasena", "contraseña", "pin", "token", "hash", "clave", "secreto"];

fn quitar_secretos(valor: &Value) -> Value {
    match valor {
        Value::Object(mapa) => Value::Object(
            mapa.iter()
                .filter(|(k, _)| {
                    let k = k.to_lowercase();
                    !CLAVES_PROHIBIDAS.iter().any(|p| k.contains(p))
                })
                .map(|(k, v)| (k.clone(), quitar_secretos(v)))
                .collect(),
        ),
        Value::Array(lista) => Value::Array(lista.iter().map(quitar_secretos).collect()),
        otro => otro.clone(),
    }
}

#[allow(clippy::too_many_arguments)]
fn calcular_hash(
    hash_previo: &str,
    ts: &str,
    actor_id: Option<&str>,
    actor_nombre: Option<&str>,
    accion: &str,
    entidad: &str,
    entidad_id: Option<&str>,
    detalle: &str,
) -> String {
    let mut h = Sha256::new();
    for parte in
        [hash_previo, ts, actor_id.unwrap_or(""), actor_nombre.unwrap_or(""), accion, entidad, entidad_id.unwrap_or(""), detalle]
    {
        // Largo + contenido: dos filas distintas no pueden producir la misma entrada.
        h.update((parte.len() as u64).to_be_bytes());
        h.update(parte.as_bytes());
    }
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

pub fn registrar(
    conn: &Connection,
    ahora: DateTime<Utc>,
    actor: Actor<'_>,
    accion: &str,
    entidad: &str,
    entidad_id: Option<&str>,
    detalle: &Value,
) -> Resultado<()> {
    let detalle = quitar_secretos(detalle).to_string();
    let ts = a_texto(ahora);
    let hash_previo: String = conn
        .query_row("SELECT hash FROM auditoria_local ORDER BY id DESC LIMIT 1", [], |f| f.get(0))
        .optional()?
        .unwrap_or_default();
    let hash = calcular_hash(&hash_previo, &ts, actor.id, actor.nombre, accion, entidad, entidad_id, &detalle);

    // El registro local y su envío al servidor se guardan juntos o no se guarda ninguno.
    // SAVEPOINT funciona igual dentro o fuera de una transacción ya abierta por quien llama.
    conn.execute_batch("SAVEPOINT auditoria")?;
    let guardar = || -> Resultado<()> {
        conn.execute(
            "INSERT INTO auditoria_local (ts_utc, actor_id, actor_nombre, accion, entidad, entidad_id, detalle, hash_previo, hash)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![ts, actor.id, actor.nombre, accion, entidad, entidad_id, detalle, hash_previo, hash],
        )?;
        if ACCIONES_QUE_SUBEN.contains(&accion) {
            let payload = serde_json::json!({
                "accion": accion,
                "entidad": entidad,
                "entidad_id": entidad_id,
                "detalle": serde_json::from_str::<Value>(&detalle).unwrap_or(Value::Null),
            });
            outbox::encolar(conn, ahora, "auditoria_estacion", actor.id, &[], &payload)?;
        }
        Ok(())
    };
    match guardar() {
        Ok(()) => {
            conn.execute_batch("RELEASE auditoria")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK TO auditoria; RELEASE auditoria");
            Err(e)
        }
    }
}

/// Recorre la cadena. Devuelve el id de la primera fila que no cuadra, o `None` si está íntegra.
pub fn primera_fila_alterada(conn: &Connection) -> Resultado<Option<i64>> {
    let mut stmt = conn.prepare(
        "SELECT id, ts_utc, actor_id, actor_nombre, accion, entidad, entidad_id, detalle, hash_previo, hash
         FROM auditoria_local ORDER BY id",
    )?;
    let mut filas = stmt.query([])?;
    let mut esperado_previo = String::new();
    while let Some(f) = filas.next()? {
        let id: i64 = f.get(0)?;
        let ts: String = f.get(1)?;
        let actor_id: Option<String> = f.get(2)?;
        let actor_nombre: Option<String> = f.get(3)?;
        let accion: String = f.get(4)?;
        let entidad: String = f.get(5)?;
        let entidad_id: Option<String> = f.get(6)?;
        let detalle: String = f.get(7)?;
        let hash_previo: String = f.get(8)?;
        let hash: String = f.get(9)?;
        let recalculado = calcular_hash(
            &hash_previo,
            &ts,
            actor_id.as_deref(),
            actor_nombre.as_deref(),
            &accion,
            &entidad,
            entidad_id.as_deref(),
            &detalle,
        );
        if hash_previo != esperado_previo || hash != recalculado {
            return Ok(Some(id));
        }
        esperado_previo = hash;
    }
    Ok(None)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db::pruebas::{base_temporal, reloj};
    use crate::reloj::Reloj;
    use serde_json::json;

    #[test]
    fn la_cadena_recien_escrita_esta_integra() {
        let (_dir, conn) = base_temporal();
        let r = reloj();
        registrar(&conn, r.ahora(), Actor::persona("s1", "Ana"), "A", "x", Some("1"), &json!({"n": 1})).unwrap();
        registrar(&conn, r.ahora(), Actor::persona("s1", "Ana"), "B", "x", None, &json!({})).unwrap();
        assert_eq!(primera_fila_alterada(&conn).unwrap(), None);
    }

    #[test]
    fn la_auditoria_no_se_puede_modificar_ni_borrar() {
        let (_dir, conn) = base_temporal();
        assert!(conn.execute("UPDATE auditoria_local SET accion = 'OTRA'", []).is_err());
        assert!(conn.execute("DELETE FROM auditoria_local", []).is_err());
    }

    #[test]
    fn una_fila_alterada_por_fuera_rompe_la_cadena() {
        let (_dir, conn) = base_temporal();
        let r = reloj();
        registrar(&conn, r.ahora(), Actor::persona("s1", "Ana"), "A", "x", None, &json!({"monto": 1000})).unwrap();
        registrar(&conn, r.ahora(), Actor::persona("s1", "Ana"), "B", "x", None, &json!({})).unwrap();
        let id_a: i64 = conn.query_row("SELECT id FROM auditoria_local WHERE accion = 'A'", [], |f| f.get(0)).unwrap();

        // Alguien con acceso al archivo quita el candado y cambia un valor.
        conn.execute_batch("DROP TRIGGER auditoria_local_sin_update;").unwrap();
        conn.execute("UPDATE auditoria_local SET detalle = '{\"monto\":1}' WHERE id = ?1", [id_a]).unwrap();

        assert_eq!(primera_fila_alterada(&conn).unwrap(), Some(id_a));
    }

    #[test]
    fn nunca_guarda_contrasenas_pin_ni_tokens() {
        let (_dir, conn) = base_temporal();
        registrar(
            &conn,
            reloj().ahora(),
            Actor::sistema(),
            "PRUEBA_SECRETOS",
            "x",
            None,
            &json!({"password": "Secreta123", "pin": "4321", "device_token": "abc", "anidado": {"hash_pin": "zzz", "metodo": "pin_no"}, "metodo": "contrasena"}),
        )
        .unwrap();
        let detalle: String =
            conn.query_row("SELECT detalle FROM auditoria_local WHERE accion = 'PRUEBA_SECRETOS'", [], |f| f.get(0)).unwrap();
        for secreto in ["Secreta123", "4321", "abc", "zzz"] {
            assert!(!detalle.contains(secreto), "no debe guardar {secreto}: {detalle}");
        }
        assert!(detalle.contains("\"metodo\":\"contrasena\""), "los datos normales sí se guardan: {detalle}");
    }
}
