//! Descarga del servidor hacia la base local (`GET /sync/pull`).
//!
//! Una fila puede llegar repetida entre rondas: todo se aplica reemplazando por id, así que
//! aplicar dos veces la misma página deja la base igual.

use std::sync::Mutex;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::auditoria::{self, Actor};
use crate::error::{ErrorApp, Resultado};
use crate::reloj::{a_texto, Reloj};
use crate::sync::transporte::{ErrorTransporte, Metodo, Peticion, Transporte};

const LIMITE_PAGINA: &str = "500";
/// Tope de páginas por ronda: evita un ciclo sin fin si el servidor respondiera siempre `hay_mas`.
const MAX_PAGINAS: usize = 2000;

pub struct Credenciales {
    pub api_base: String,
    pub token: String,
}

/// Credenciales de la estación, o `None` si no está activada o fue revocada.
pub fn credenciales(conn: &Connection) -> Resultado<Option<Credenciales>> {
    Ok(conn
        .query_row(
            "SELECT api_base, device_token FROM estacion
             WHERE id = 1 AND activada_en IS NOT NULL AND revocada_en IS NULL
               AND api_base IS NOT NULL AND device_token IS NOT NULL",
            [],
            |f| Ok(Credenciales { api_base: f.get(0)?, token: f.get(1)? }),
        )
        .optional()?)
}

fn texto(v: &Value, campo: &str) -> Option<String> {
    v[campo].as_str().map(str::to_string)
}

fn entero(v: &Value, campo: &str) -> i64 {
    v[campo].as_i64().unwrap_or(0)
}

fn booleano(v: &Value, campo: &str) -> i64 {
    v[campo].as_bool().unwrap_or(false) as i64
}

/// Instante del servidor reescrito en el formato local (UTC con milisegundos), para que ordene
/// igual como texto que como fecha.
fn instante_normalizado(v: &Value, campo: &str) -> Option<String> {
    let t = v[campo].as_str()?;
    DateTime::parse_from_rfc3339(t).ok().map(|d| a_texto(d.with_timezone(&Utc)))
}

fn respuesta_invalida(que: &str) -> ErrorApp {
    eprintln!("[descarga] respuesta inesperada del servidor: falta {que}");
    ErrorApp::nuevo("RESPUESTA_INVALIDA", "El servidor respondió algo que esta versión de GymDesk no entiende. Actualiza la aplicación.")
}

fn obligatorio(v: &Value, campo: &str) -> Resultado<String> {
    texto(v, campo).ok_or_else(|| respuesta_invalida(campo))
}

fn filas<'a>(respuesta: &'a Value, tabla: &str) -> impl Iterator<Item = &'a Value> {
    respuesta["cambios"][tabla].as_array().into_iter().flatten()
}

pub struct ResumenPagina {
    pub hay_mas: bool,
    pub filas: usize,
}

/// Aplica una página de la descarga en una sola transacción local, junto con el cursor.
pub fn aplicar_pagina(conn: &Connection, ahora: DateTime<Utc>, r: &Value) -> Resultado<ResumenPagina> {
    let cursor = obligatorio(r, "cursor")?;
    let hay_mas = r["hay_mas"].as_bool().ok_or_else(|| respuesta_invalida("hay_mas"))?;
    let ts = a_texto(ahora);
    let mut total = 0usize;
    let tx = conn.unchecked_transaction()?;

    if r["reiniciar"].as_bool().unwrap_or(false) {
        // Las marcas del servidor cambiaron: lo que llega es la verdad completa.
        tx.execute_batch(
            "DELETE FROM gimnasio; DELETE FROM permisos_rol; DELETE FROM planes; DELETE FROM productos;
             DELETE FROM deportistas; DELETE FROM membresias; DELETE FROM congelamientos; DELETE FROM pases_dia;
             UPDATE staff_local SET activo = 0, eliminado = 1;
             UPDATE sync_estado SET descarga_inicial_completa = 0 WHERE id = 1;",
        )?;
    }

    for g in filas(r, "gimnasio") {
        tx.execute(
            "INSERT OR REPLACE INTO gimnasio (id, nombre, subdominio, zona_horaria, dias_gracia_mora, dias_umbral_por_vencer,
               permitir_descuentos, tope_descuento_pct, metodos_pago, branding, duracion_sesion_minutos,
               precio_pase_dia, precio_pase_clase)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                obligatorio(g, "id")?, obligatorio(g, "nombre")?, obligatorio(g, "subdominio")?,
                texto(g, "zona_horaria").unwrap_or_else(|| "America/Bogota".into()),
                entero(g, "dias_gracia_mora"), entero(g, "dias_umbral_por_vencer"), booleano(g, "permitir_descuentos"),
                entero(g, "tope_descuento_pct"), g["metodos_pago"].to_string(), g["branding"].to_string(),
                entero(g, "duracion_sesion_minutos"), g["precio_pase_dia"].as_i64(), g["precio_pase_clase"].as_i64(),
            ],
        )?;
        tx.execute("UPDATE estacion SET gimnasio_nombre = ?1 WHERE id = 1", [obligatorio(g, "nombre")?])?;
        total += 1;
    }

    for s in filas(r, "staff") {
        let eliminado = booleano(s, "eliminado");
        let activo = if eliminado == 1 { 0 } else { booleano(s, "activo") };
        tx.execute(
            "INSERT INTO staff_local (id, nombre, correo, rol, activo, eliminado, password_cambiada_en, actualizado_en)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, correo = excluded.correo, rol = excluded.rol,
               activo = excluded.activo, eliminado = excluded.eliminado,
               password_cambiada_en = excluded.password_cambiada_en, actualizado_en = excluded.actualizado_en",
            params![
                obligatorio(s, "id")?, obligatorio(s, "nombre")?, obligatorio(s, "correo")?.to_lowercase(),
                obligatorio(s, "rol")?, activo, eliminado, texto(s, "password_cambiada_en"), ts,
            ],
        )?;
        total += 1;
    }
    invalidar_credenciales_cambiadas(&tx, ahora)?;

    for p in filas(r, "permisos") {
        tx.execute(
            "INSERT OR REPLACE INTO permisos_rol (id, rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                obligatorio(p, "id")?, obligatorio(p, "rol")?, obligatorio(p, "submodulo")?, booleano(p, "puede_crear"),
                booleano(p, "puede_leer"), booleano(p, "puede_editar"), booleano(p, "puede_eliminar"),
            ],
        )?;
        total += 1;
    }
    for p in filas(r, "planes") {
        tx.execute(
            "INSERT OR REPLACE INTO planes (id, nombre, precio, duracion_dias, tipo, cupo_personas, activo) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                obligatorio(p, "id")?, obligatorio(p, "nombre")?, entero(p, "precio"), entero(p, "duracion_dias"),
                obligatorio(p, "tipo")?, entero(p, "cupo_personas"), booleano(p, "activo"),
            ],
        )?;
        total += 1;
    }
    for p in filas(r, "productos") {
        tx.execute(
            "INSERT OR REPLACE INTO productos (id, nombre, precio, stock, activo) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![obligatorio(p, "id")?, obligatorio(p, "nombre")?, entero(p, "precio"), entero(p, "stock"), booleano(p, "activo")],
        )?;
        total += 1;
    }
    for d in filas(r, "deportistas") {
        tx.execute(
            "INSERT OR REPLACE INTO deportistas (id, tipo_documento, documento, nombre, activo, eliminado, salud) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                obligatorio(d, "id")?, texto(d, "tipo_documento"), obligatorio(d, "documento")?, obligatorio(d, "nombre")?,
                booleano(d, "activo"), booleano(d, "eliminado"), d.get("salud").filter(|s| !s.is_null()).map(|s| s.to_string()),
            ],
        )?;
        total += 1;
    }
    for m in filas(r, "membresias") {
        tx.execute(
            "INSERT OR REPLACE INTO membresias (id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada, created_at,
               plan_precio_vendido)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                obligatorio(m, "id")?, obligatorio(m, "deportista_id")?, obligatorio(m, "plan_id")?,
                obligatorio(m, "fecha_inicio")?, obligatorio(m, "fecha_vencimiento")?, booleano(m, "cancelada"),
                instante_normalizado(m, "created_at"), m["plan_precio_vendido"].as_i64(),
            ],
        )?;
        total += 1;
    }
    for c in filas(r, "congelamientos") {
        tx.execute(
            "INSERT OR REPLACE INTO congelamientos (id, membresia_id, fecha_inicio, fecha_fin) VALUES (?1, ?2, ?3, ?4)",
            params![obligatorio(c, "id")?, obligatorio(c, "membresia_id")?, obligatorio(c, "fecha_inicio")?, texto(c, "fecha_fin")],
        )?;
        total += 1;
    }
    for p in filas(r, "pases_dia") {
        let creado = instante_normalizado(p, "created_at").ok_or_else(|| respuesta_invalida("pases_dia.created_at"))?;
        tx.execute(
            "INSERT OR REPLACE INTO pases_dia (id, deportista_id, created_at, anulada) VALUES (?1, ?2, ?3, ?4)",
            params![obligatorio(p, "id")?, obligatorio(p, "deportista_id")?, creado, booleano(p, "anulada")],
        )?;
        total += 1;
    }
    // Lo cobrado aquí que aún no llegó al servidor no se deshace con la descarga.
    crate::caja::membresias::reaplicar_sin_subir(&tx)?;

    // Un pase de día solo sirve el día en que se pagó: los viejos ya no hacen falta.
    tx.execute("DELETE FROM pases_dia WHERE created_at < ?1", [a_texto(ahora - chrono::Duration::days(3))])?;

    for e in r["eliminados"].as_array().into_iter().flatten() {
        let id = obligatorio(e, "id")?;
        // Lista cerrada: el nombre de tabla nunca sale del texto que mandó el servidor.
        match e["tabla"].as_str() {
            Some("planes") => tx.execute("DELETE FROM planes WHERE id = ?1", [&id])?,
            Some("productos") => tx.execute("DELETE FROM productos WHERE id = ?1", [&id])?,
            Some("deportistas") => tx.execute("DELETE FROM deportistas WHERE id = ?1", [&id])?,
            Some("membresias") => tx.execute("DELETE FROM membresias WHERE id = ?1", [&id])?,
            Some("congelamientos") => tx.execute("DELETE FROM congelamientos WHERE id = ?1", [&id])?,
            Some("ventas") => tx.execute("DELETE FROM pases_dia WHERE id = ?1", [&id])?,
            Some("permisos_rol") => tx.execute("DELETE FROM permisos_rol WHERE id = ?1", [&id])?,
            Some("staff") => tx.execute("UPDATE staff_local SET activo = 0, eliminado = 1 WHERE id = ?1", [&id])?,
            _ => 0,
        };
        total += 1;
    }

    let s = &r["suscripcion"];
    tx.execute(
        "UPDATE suscripcion SET estado_guardado = ?1, fecha_corte = ?2, bloqueado_por_servidor = 0, motivo_servidor = NULL,
           actualizada_en = ?3 WHERE id = 1",
        params![texto(s, "estado_guardado"), texto(s, "fecha_corte"), ts],
    )?;

    if hay_mas {
        tx.execute("UPDATE sync_estado SET cursor = ?1 WHERE id = 1", [&cursor])?;
    } else {
        tx.execute(
            "UPDATE sync_estado SET cursor = ?1, descarga_inicial_completa = 1, ultima_descarga_ok = ?2 WHERE id = 1",
            params![cursor, ts],
        )?;
    }
    tx.commit()?;
    Ok(ResumenPagina { hay_mas, filas: total })
}

/// Si la contraseña de alguien cambió en la web, su verificador local y su PIN dejan de servir (E-19).
fn invalidar_credenciales_cambiadas(conn: &Connection, ahora: DateTime<Utc>) -> Resultado<()> {
    let afectados: Vec<(String, String)> = {
        let mut stmt = conn.prepare(
            "SELECT id, nombre FROM staff_local
             WHERE hash_password IS NOT NULL AND credencial_marca IS NOT password_cambiada_en",
        )?;
        let filas = stmt.query_map([], |f| Ok((f.get(0)?, f.get(1)?)))?;
        filas.collect::<Result<_, _>>()?
    };
    for (id, nombre) in afectados {
        conn.execute("UPDATE staff_local SET hash_password = NULL, hash_pin = NULL, pin_creado_en = NULL WHERE id = ?1", [&id])?;
        auditoria::registrar(
            conn,
            ahora,
            Actor::sistema(),
            "INVALIDAR_CREDENCIAL",
            "staff_local",
            Some(&id),
            &json!({ "motivo": "cambio_en_la_web", "persona": nombre }),
        )?;
    }
    Ok(())
}

/// Qué pasó con una ronda de descarga.
#[derive(Debug, PartialEq)]
pub enum ResultadoDescarga {
    Completa { filas: usize },
    /// El servidor respondió que el gimnasio está bloqueado: quedó anotado en la base local.
    GimnasioBloqueado,
    /// El Jefe revocó la estación: quedó anotado y deja de sincronizar.
    EstacionRevocada,
    SinActivar,
}

/// Descarga una ronda completa. No mantiene tomada la base mientras espera la red.
pub fn descargar(base: &Mutex<Connection>, transporte: &dyn Transporte, reloj: &dyn Reloj) -> Result<ResultadoDescarga, ErrorTransporte> {
    let local = |e: ErrorApp| ErrorTransporte::Servidor { status: 0, codigo: e.codigo, mensaje: e.mensaje, detalles: e.detalles };
    let mut total = 0usize;
    for _ in 0..MAX_PAGINAS {
        let (cred, cursor) = {
            let conn = base.lock().unwrap_or_else(|e| e.into_inner());
            let Some(cred) = credenciales(&conn).map_err(local)? else { return Ok(ResultadoDescarga::SinActivar) };
            let cursor: Option<String> =
                conn.query_row("SELECT cursor FROM sync_estado WHERE id = 1", [], |f| f.get(0)).map_err(|e| local(e.into()))?;
            (cred, cursor)
        };

        let mut consulta = vec![("limite", LIMITE_PAGINA.to_string())];
        if let Some(c) = cursor {
            consulta.push(("cursor", c));
        }
        let respuesta = transporte.enviar(
            &cred.api_base,
            Peticion { metodo: Metodo::Get, ruta: "/sync/pull", token: Some(&cred.token), consulta, cuerpo: None },
        );

        let conn = base.lock().unwrap_or_else(|e| e.into_inner());
        match respuesta {
            Ok(cuerpo) => {
                let pagina = aplicar_pagina(&conn, reloj.ahora(), &cuerpo).map_err(local)?;
                total += pagina.filas;
                if !pagina.hay_mas {
                    return Ok(ResultadoDescarga::Completa { filas: total });
                }
            }
            Err(ErrorTransporte::Servidor { codigo, detalles, .. }) if codigo == "GIMNASIO_SUSPENDIDO" => {
                let motivo = detalles.as_ref().and_then(|d| d["motivo"].as_str()).unwrap_or("suspendido").to_string();
                conn.execute(
                    "UPDATE suscripcion SET bloqueado_por_servidor = 1, motivo_servidor = ?1, actualizada_en = ?2 WHERE id = 1",
                    params![motivo, a_texto(reloj.ahora())],
                )
                .map_err(|e| local(e.into()))?;
                return Ok(ResultadoDescarga::GimnasioBloqueado);
            }
            Err(ErrorTransporte::Servidor { codigo, .. }) if codigo == "ESTACION_REVOCADA" => {
                conn.execute("UPDATE estacion SET revocada_en = ?1 WHERE id = 1 AND revocada_en IS NULL", [a_texto(reloj.ahora())])
                    .map_err(|e| local(e.into()))?;
                return Ok(ResultadoDescarga::EstacionRevocada);
            }
            Err(e) => return Err(e),
        }
    }
    Err(ErrorTransporte::Servidor {
        status: 0,
        codigo: "DESCARGA_SIN_FIN".into(),
        mensaje: "La descarga no terminó. Intenta de nuevo; si se repite, contacta a soporte.".into(),
        detalles: None,
    })
}
