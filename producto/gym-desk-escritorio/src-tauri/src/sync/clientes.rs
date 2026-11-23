//! Registrar un cliente desde la estación, con foto opcional (E-41). Exige conexión: el servidor valida
//! las mismas reglas de la web (consentimiento, menor con acudiente, documento único) y lo crea. La
//! estación lo guarda de inmediato, con su foto, para que pueda entrar o cobrarle sin esperar la descarga.

use std::sync::Mutex;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use crate::acceso::registro::{evaluar_cliente, ClienteEvaluado};
use crate::auditoria::{self, Actor};
use crate::error::{ErrorApp, Resultado};
use crate::reloj::{a_texto, fecha_negocio, Reloj};
use crate::sesion::{GestorSesion, UsuarioSesion};
use crate::sync::descarga::credenciales;
use crate::sync::exigir_operable;
use crate::sync::transporte::{ErrorTransporte, Metodo, Peticion, Transporte};

/// 3 MB de imagen en base64, como el servidor.
const MAX_FOTO_BASE64: usize = 3 * 1024 * 1024 * 4 / 3 + 64;

fn interno() -> ErrorApp {
    ErrorApp::nuevo("ERROR_INTERNO", "GymDesk tuvo un error interno. Cierra y vuelve a abrir la aplicación.")
}

/// Permiso de crear deportistas según lo descargado. El Jefe siempre; sin fila de permiso, no.
pub fn puede_registrar(conn: &Connection, usuario: &UsuarioSesion) -> Resultado<bool> {
    if usuario.rol == "jefe" {
        return Ok(true);
    }
    let puede: Option<bool> = conn
        .query_row("SELECT puede_crear FROM permisos_rol WHERE rol = ?1 AND submodulo = 'deportistas'", [&usuario.rol], |f| f.get(0))
        .optional()?;
    Ok(puede == Some(true))
}

/// Guarda en la estación el cliente que el servidor acaba de crear, con su foto si la hay.
pub fn guardar_registrado(
    conn: &Connection,
    ahora: DateTime<Utc>,
    usuario: &UsuarioSesion,
    respuesta: &Value,
    foto_data_url: Option<&str>,
    salud: Option<&Value>,
) -> Resultado<ClienteEvaluado> {
    let invalida =
        || ErrorApp::nuevo("RESPUESTA_INVALIDA", "El servidor respondió algo que esta versión de GymDesk no entiende. Actualiza la aplicación.");
    let id = respuesta["id"].as_str().ok_or_else(invalida)?;
    let documento = respuesta["documento"].as_str().ok_or_else(invalida)?;
    let nombre = respuesta["nombre"].as_str().ok_or_else(invalida)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT OR REPLACE INTO deportistas (id, tipo_documento, documento, nombre, activo, eliminado, salud) VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
        params![id, respuesta["tipo_documento"].as_str(), documento, nombre, respuesta["activo"].as_bool().unwrap_or(true), salud.filter(|s| !s.is_null()).map(|s| s.to_string())],
    )?;
    let con_foto = respuesta["con_foto"].as_bool().unwrap_or(false);
    if let (true, Some(foto)) = (con_foto, foto_data_url) {
        tx.execute(
            "INSERT OR REPLACE INTO fotos_clientes (deportista_id, data_url, tomada_en) VALUES (?1, ?2, ?3)",
            params![id, foto, a_texto(ahora)],
        )?;
    }
    auditoria::registrar(
        &tx,
        ahora,
        Actor::persona(&usuario.id, &usuario.nombre),
        "REGISTRAR_CLIENTE",
        "deportistas",
        Some(id),
        &json!({ "con_foto": con_foto }),
    )?;
    tx.commit()?;
    evaluar_cliente(conn, id, fecha_negocio(ahora))?.ok_or_else(interno)
}

/// Registra el cliente en el servidor y lo guarda en la estación.
pub fn registrar(
    base: &Mutex<Connection>,
    sesion: &Mutex<GestorSesion>,
    transporte: &dyn Transporte,
    reloj: &dyn Reloj,
    cliente: &Value,
    foto_data_url: Option<&str>,
) -> Resultado<ClienteEvaluado> {
    let foto = foto_data_url.map(str::trim).filter(|f| !f.is_empty());
    if foto.is_some_and(|f| f.len() > MAX_FOTO_BASE64) {
        return Err(ErrorApp::nuevo("FOTO_MUY_GRANDE", "La foto no puede pesar más de 3 MB."));
    }
    // 1. Quién registra y con qué credencial. Orden de candados: sesión, después base.
    let (usuario, cred) = {
        let mut gestor = sesion.lock().map_err(|_| interno())?;
        let conn = base.lock().map_err(|_| interno())?;
        let ahora = reloj.ahora();
        let usuario = gestor.exigir_activa(&conn, ahora)?;
        exigir_operable(&conn, ahora)?;
        if !puede_registrar(&conn, &usuario)? {
            return Err(ErrorApp::nuevo("PERMISO_DENEGADO", "No tienes permiso para registrar clientes. Pídeselo al Jefe."));
        }
        let cred = credenciales(&conn)?.ok_or_else(|| ErrorApp::nuevo("ESTACION_SIN_ACTIVAR", "Esta estación aún no está activada."))?;
        (usuario, cred)
    };

    // 2. El servidor lo crea, sin tener tomada la base mientras responde.
    let cuerpo = json!({ "staff_id": usuario.id, "cliente": cliente, "foto_base64": foto });
    let respuesta = transporte.enviar(
        &cred.api_base,
        Peticion { metodo: Metodo::Post, ruta: "/sync/clientes", token: Some(&cred.token), consulta: vec![], cuerpo: Some(&cuerpo) },
    );
    let r = match respuesta {
        Ok(r) => r,
        Err(ErrorTransporte::SinConexion(_)) => {
            return Err(ErrorApp::nuevo(
                "NECESITA_CONEXION",
                "Para registrar un cliente se necesita internet. Mientras tanto puedes venderle un pase de día a un cliente ya registrado o registrar una cortesía.",
            ))
        }
        Err(e) => return Err(e.a_error_app()),
    };

    // 3. Se guarda en la estación.
    let conn = base.lock().map_err(|_| interno())?;
    guardar_registrado(&conn, reloj.ahora(), &usuario, &r, foto, cliente.get("salud"))
}

/// Foto del cliente tomada en esta estación, como data URL.
pub fn foto(conn: &Connection, deportista_id: &str) -> Resultado<Option<String>> {
    Ok(conn.query_row("SELECT data_url FROM fotos_clientes WHERE deportista_id = ?1", [deportista_id], |f| f.get(0)).optional()?)
}


/// Llamada al servidor en nombre de la persona con sesión (mediciones). Exige conexión.
pub fn en_linea(
    base: &Mutex<Connection>,
    sesion: &Mutex<GestorSesion>,
    transporte: &dyn Transporte,
    reloj: &dyn Reloj,
    metodo: Metodo,
    ruta: &str,
    cuerpo: Option<Value>,
) -> Resultado<Value> {
    let (usuario, cred) = {
        let mut gestor = sesion.lock().map_err(|_| interno())?;
        let conn = base.lock().map_err(|_| interno())?;
        let ahora = reloj.ahora();
        let usuario = gestor.exigir_activa(&conn, ahora)?;
        exigir_operable(&conn, ahora)?;
        let cred = credenciales(&conn)?.ok_or_else(|| ErrorApp::nuevo("ESTACION_SIN_ACTIVAR", "Esta estación aún no está activada."))?;
        (usuario, cred)
    };
    let es_get = matches!(metodo, Metodo::Get);
    let cuerpo = cuerpo.map(|c| json!({ "staff_id": usuario.id, "medicion": c }));
    let consulta = if es_get { vec![("staff_id", usuario.id.clone())] } else { vec![] };
    match transporte.enviar(&cred.api_base, Peticion { metodo, ruta, token: Some(&cred.token), consulta, cuerpo: cuerpo.as_ref() }) {
        Ok(r) => Ok(r),
        Err(ErrorTransporte::SinConexion(_)) => Err(ErrorApp::nuevo("NECESITA_CONEXION", "Las medidas se consultan y registran con internet.")),
        Err(e) => Err(e.a_error_app()),
    }
}

/// Ruta segura hacia las mediciones de un cliente (el id no puede traer barras ni nada raro).
pub fn ruta_mediciones(deportista_id: &str) -> Resultado<String> {
    if deportista_id.is_empty() || !deportista_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Err(ErrorApp::nuevo("DATOS_INVALIDOS", "Cliente inválido."));
    }
    Ok(format!("/sync/clientes/{deportista_id}/mediciones"))
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

    fn usuario(rol: &str) -> UsuarioSesion {
        UsuarioSesion { id: ANA.into(), nombre: "Ana Ruiz".into(), correo: "ana@gimnasio.co".into(), rol: rol.into(), tiene_pin: true }
    }

    #[test]
    fn el_cliente_registrado_queda_en_la_estacion_con_su_foto_y_sin_membresia() {
        let (_d, conn) = base_temporal();
        aplicar_pagina(&conn, ahora(), &pagina("c1", false, json!({ "gimnasio": [fila_gimnasio()] }))).unwrap();
        let foto = "data:image/jpeg;base64,/9j/4AAQ";
        let r = json!({ "id": "nuevo", "tipo_documento": "CC", "documento": "10203040", "nombre": "Pedro Gómez", "activo": true, "con_foto": true });
        let c = guardar_registrado(&conn, ahora(), &usuario("recepcionista"), &r, Some(foto), None).unwrap();
        assert_eq!((c.nombre.as_str(), c.estado, c.abre), ("Pedro Gómez", "sin_membresia", false));
        assert_eq!(c.foto.as_deref(), Some(foto));
        assert_eq!(super::foto(&conn, "nuevo").unwrap().as_deref(), Some(foto));
        // Una descarga posterior trae al mismo cliente: no se duplica y conserva la foto.
        let d = json!({ "id": "nuevo", "tipo_documento": "CC", "documento": "10203040", "nombre": "Pedro Gómez", "activo": true, "eliminado": false });
        aplicar_pagina(&conn, ahora(), &pagina("c2", false, json!({ "deportistas": [d] }))).unwrap();
        let n: i64 = conn.query_row("SELECT count(*) FROM deportistas WHERE documento = '10203040'", [], |f| f.get(0)).unwrap();
        assert_eq!(n, 1);
        assert!(super::foto(&conn, "nuevo").unwrap().is_some());
    }

    #[test]
    fn sin_permiso_de_deportistas_no_se_registra() {
        let (_d, conn) = base_temporal();
        assert!(puede_registrar(&conn, &usuario("jefe")).unwrap());
        assert!(!puede_registrar(&conn, &usuario("recepcionista")).unwrap());
        let permiso = json!({ "id": "p1", "rol": "recepcionista", "submodulo": "deportistas", "puede_crear": true, "puede_leer": true,
                              "puede_editar": false, "puede_eliminar": false });
        aplicar_pagina(&conn, ahora(), &pagina("c1", false, json!({ "permisos": [permiso] }))).unwrap();
        assert!(puede_registrar(&conn, &usuario("recepcionista")).unwrap());
    }
}
