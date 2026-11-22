//! Pruebas de activación y descarga contra una base SQLCipher real.

use std::sync::Mutex;

use rusqlite::Connection;
use serde_json::json;

use crate::db::pruebas::{base_temporal, reloj};
use crate::sesion::credenciales::generar_hash;
use crate::sync::activacion::activar;
use crate::sync::descarga::{aplicar_pagina, descargar, ResultadoDescarga};
use crate::sync::pruebas_util::*;
use crate::reloj::Reloj;

fn contar(conn: &Connection, tabla: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {tabla}"), [], |f| f.get(0)).unwrap()
}

fn pagina_completa() -> serde_json::Value {
    pagina(
        "cursor-1",
        false,
        json!({
            "gimnasio": [fila_gimnasio()],
            "staff": [fila_staff(ANA, "Ana Ruiz", "Ana@Gimnasio.co")],
            "permisos": [{ "id": "p1", "rol": "recepcionista", "submodulo": "caja", "puede_crear": true, "puede_leer": true, "puede_editar": false, "puede_eliminar": false }],
            "planes": [{ "id": "pl1", "nombre": "Mensual", "precio": 80000, "duracion_dias": 30, "tipo": "individual", "cupo_personas": 1, "activo": true }],
            "productos": [{ "id": "pr1", "nombre": "Agua", "precio": 3000, "stock": 24, "activo": true }],
            "deportistas": [{ "id": "d1", "tipo_documento": "CC", "documento": "1002003004", "nombre": "Luis Pérez", "activo": true, "eliminado": false }],
            "membresias": [{ "id": "m1", "deportista_id": "d1", "plan_id": "pl1", "fecha_inicio": "2026-11-01", "fecha_vencimiento": "2026-12-01", "cancelada": false }]
        }),
    )
}

#[test]
fn activar_guarda_el_token_en_la_base_cifrada_y_deja_la_estacion_lista() {
    let (_dir, conn) = base_temporal();
    let base = Mutex::new(conn);
    let t = TransporteGuion::con(vec![Ok(respuesta_activar())]);

    activar(&base, &t, &reloj(), " PowerGym.gymdeskcolombia.com ", "abcd-efgh").unwrap();

    let pedido = t.pedidos.lock().unwrap()[0].clone();
    assert_eq!(pedido.0, "/sync/activar");
    assert_eq!(pedido.1, None, "la activación no lleva token");
    let cuerpo = pedido.3.unwrap();
    assert_eq!((cuerpo["subdominio"].as_str(), cuerpo["codigo"].as_str()), (Some("powergym"), Some("ABCDEFGH")));

    let conn = base.lock().unwrap();
    let (token, nombre, activada): (String, String, bool) = conn
        .query_row("SELECT device_token, gimnasio_nombre, activada_en IS NOT NULL FROM estacion", [], |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)))
        .unwrap();
    assert_eq!((token.as_str(), nombre.as_str(), activada), ("token-de-la-estacion", "Power Gym", true));
    let auditoria: String = conn.query_row("SELECT group_concat(accion || detalle) FROM auditoria_local", [], |f| f.get(0)).unwrap();
    assert!(auditoria.contains("ACTIVAR_ESTACION") && !auditoria.contains("token-de-la-estacion"));
}

#[test]
fn si_el_servidor_rechaza_el_codigo_la_estacion_sigue_sin_activar() {
    let (_dir, conn) = base_temporal();
    let base = Mutex::new(conn);
    let t = TransporteGuion::con(vec![Err(error_servidor(404, "CODIGO_INVALIDO", None))]);
    assert_eq!(activar(&base, &t, &reloj(), "powergym", "ABCD-EFGH").unwrap_err().codigo, "CODIGO_INVALIDO");

    let sin_red = TransporteGuion::default();
    assert_eq!(activar(&base, &sin_red, &reloj(), "powergym", "ABCD-EFGH").unwrap_err().codigo, "SIN_CONEXION");
    assert_eq!(activar(&base, &sin_red, &reloj(), "powergym", "ABC").unwrap_err().codigo, "CODIGO_INCOMPLETO");

    let activada: bool = base.lock().unwrap().query_row("SELECT activada_en IS NOT NULL FROM estacion", [], |f| f.get(0)).unwrap();
    assert!(!activada);
}

#[test]
fn una_estacion_activada_no_se_activa_otra_vez() {
    let (_dir, base) = base_activada();
    let t = TransporteGuion::con(vec![Ok(respuesta_activar())]);
    assert_eq!(activar(&base, &t, &reloj(), "powergym", "ABCD-EFGH").unwrap_err().codigo, "ESTACION_YA_ACTIVADA");
    assert!(t.rutas().is_empty(), "no debe salir a la red");
}

#[test]
fn la_descarga_inicial_deja_todo_en_la_base_local_con_dinero_en_enteros() {
    let (_dir, base) = base_activada();
    let t = TransporteGuion::con(vec![Ok(pagina_completa())]);

    assert_eq!(descargar(&base, &t, &reloj()).unwrap(), ResultadoDescarga::Completa { filas: 7 });

    let conn = base.lock().unwrap();
    for tabla in ["gimnasio", "staff_local", "permisos_rol", "planes", "productos", "deportistas", "membresias"] {
        assert_eq!(contar(&conn, tabla), 1, "{tabla}");
    }
    let (precio, gracia): (i64, i64) = conn
        .query_row("SELECT (SELECT precio FROM planes), (SELECT dias_gracia_mora FROM gimnasio)", [], |f| Ok((f.get(0)?, f.get(1)?)))
        .unwrap();
    assert_eq!((precio, gracia), (80000, 3));
    let correo: String = conn.query_row("SELECT correo FROM staff_local", [], |f| f.get(0)).unwrap();
    assert_eq!(correo, "ana@gimnasio.co");
    let (cursor, completa): (String, bool) =
        conn.query_row("SELECT cursor, descarga_inicial_completa FROM sync_estado", [], |f| Ok((f.get(0)?, f.get(1)?))).unwrap();
    assert_eq!((cursor.as_str(), completa), ("cursor-1", true));

    let pedido = t.pedidos.lock().unwrap()[0].clone();
    assert_eq!(pedido.1.as_deref(), Some("token-de-la-estacion"));
    assert!(!pedido.2.iter().any(|(k, _)| k == "cursor"), "la primera descarga va sin cursor");
}

#[test]
fn la_descarga_sigue_las_paginas_y_manda_el_cursor_de_cada_una() {
    let (_dir, base) = base_activada();
    let t = TransporteGuion::con(vec![
        Ok(pagina("c1", true, json!({ "gimnasio": [fila_gimnasio()] }))),
        Ok(pagina("c2", true, json!({ "staff": [fila_staff(ANA, "Ana", "ana@gimnasio.co")] }))),
        Ok(pagina("c3", false, json!({}))),
    ]);
    assert_eq!(descargar(&base, &t, &reloj()).unwrap(), ResultadoDescarga::Completa { filas: 2 });
    let cursores: Vec<Option<String>> =
        t.pedidos.lock().unwrap().iter().map(|p| p.2.iter().find(|(k, _)| k == "cursor").map(|(_, v)| v.clone())).collect();
    assert_eq!(cursores, vec![None, Some("c1".into()), Some("c2".into())]);
}

#[test]
fn si_la_red_se_cae_a_mitad_la_siguiente_descarga_retoma_donde_iba() {
    let (_dir, base) = base_activada();
    let t = TransporteGuion::con(vec![Ok(pagina("c1", true, json!({ "gimnasio": [fila_gimnasio()] }))), Err(sin_conexion())]);
    assert!(descargar(&base, &t, &reloj()).unwrap_err().es_sin_conexion());
    {
        let conn = base.lock().unwrap();
        let (cursor, completa): (String, bool) =
            conn.query_row("SELECT cursor, descarga_inicial_completa FROM sync_estado", [], |f| Ok((f.get(0)?, f.get(1)?))).unwrap();
        assert_eq!((cursor.as_str(), completa), ("c1", false));
    }
    t.agregar(Ok(pagina("c2", false, json!({ "staff": [fila_staff(ANA, "Ana", "ana@gimnasio.co")] }))));
    assert_eq!(descargar(&base, &t, &reloj()).unwrap(), ResultadoDescarga::Completa { filas: 1 });
    assert_eq!(t.pedidos.lock().unwrap().last().unwrap().2.iter().find(|(k, _)| k == "cursor").unwrap().1, "c1");
}

#[test]
fn aplicar_dos_veces_la_misma_pagina_no_duplica_nada() {
    let (_dir, base) = base_activada();
    let conn = base.lock().unwrap();
    aplicar_pagina(&conn, reloj().ahora(), &pagina_completa()).unwrap();
    aplicar_pagina(&conn, reloj().ahora(), &pagina_completa()).unwrap();
    for tabla in ["gimnasio", "staff_local", "planes", "productos", "deportistas", "membresias"] {
        assert_eq!(contar(&conn, tabla), 1, "{tabla}");
    }
}

#[test]
fn un_plan_eliminado_en_el_servidor_desaparece_de_la_estacion() {
    let (_dir, base) = base_activada();
    let conn = base.lock().unwrap();
    aplicar_pagina(&conn, reloj().ahora(), &pagina_completa()).unwrap();
    let mut p = pagina("c2", false, json!({}));
    p["eliminados"] = json!([{ "tabla": "planes", "id": "pl1" }, { "tabla": "tabla_rara; DROP TABLE planes", "id": "x" }]);
    aplicar_pagina(&conn, reloj().ahora(), &p).unwrap();
    assert_eq!(contar(&conn, "planes"), 0);
    assert_eq!(contar(&conn, "productos"), 1);
}

#[test]
fn la_descarga_no_borra_el_verificador_local_ni_el_pin_de_quien_no_cambio_la_contrasena() {
    let (_dir, base) = base_activada();
    let conn = base.lock().unwrap();
    aplicar_pagina(&conn, reloj().ahora(), &pagina_completa()).unwrap();
    conn.execute("UPDATE staff_local SET hash_password = ?1, hash_pin = 'pin', credencial_marca = NULL", [generar_hash("x").unwrap()]).unwrap();

    let mut p = pagina_completa();
    p["cambios"]["staff"][0]["nombre"] = json!("Ana Ruiz de Pérez");
    aplicar_pagina(&conn, reloj().ahora(), &p).unwrap();

    let (nombre, con_hash, con_pin): (String, bool, bool) = conn
        .query_row("SELECT nombre, hash_password IS NOT NULL, hash_pin IS NOT NULL FROM staff_local", [], |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)))
        .unwrap();
    assert_eq!((nombre.as_str(), con_hash, con_pin), ("Ana Ruiz de Pérez", true, true));
}

#[test]
fn si_la_contrasena_cambio_en_la_web_se_invalidan_el_verificador_local_y_el_pin() {
    let (_dir, base) = base_activada();
    let conn = base.lock().unwrap();
    aplicar_pagina(&conn, reloj().ahora(), &pagina_completa()).unwrap();
    conn.execute("UPDATE staff_local SET hash_password = ?1, hash_pin = 'pin', credencial_marca = NULL", [generar_hash("x").unwrap()]).unwrap();

    let mut p = pagina_completa();
    p["cambios"]["staff"][0]["password_cambiada_en"] = json!("2026-11-12T16:00:00+00:00");
    aplicar_pagina(&conn, reloj().ahora(), &p).unwrap();

    let (con_hash, con_pin): (bool, bool) =
        conn.query_row("SELECT hash_password IS NOT NULL, hash_pin IS NOT NULL FROM staff_local", [], |f| Ok((f.get(0)?, f.get(1)?))).unwrap();
    assert_eq!((con_hash, con_pin), (false, false));
    let invalidaciones: i64 =
        conn.query_row("SELECT count(*) FROM auditoria_local WHERE accion = 'INVALIDAR_CREDENCIAL'", [], |f| f.get(0)).unwrap();
    assert_eq!(invalidaciones, 1);
}

#[test]
fn personal_eliminado_o_desactivado_queda_inactivo_en_la_estacion() {
    let (_dir, base) = base_activada();
    let conn = base.lock().unwrap();
    aplicar_pagina(&conn, reloj().ahora(), &pagina_completa()).unwrap();
    let mut p = pagina_completa();
    p["cambios"]["staff"][0]["eliminado"] = json!(true);
    aplicar_pagina(&conn, reloj().ahora(), &p).unwrap();
    let (activo, eliminado): (bool, bool) = conn.query_row("SELECT activo, eliminado FROM staff_local", [], |f| Ok((f.get(0)?, f.get(1)?))).unwrap();
    assert_eq!((activo, eliminado), (false, true));
}

#[test]
fn con_reiniciar_la_copia_local_se_reemplaza_por_lo_que_llega() {
    let (_dir, base) = base_activada();
    let conn = base.lock().unwrap();
    aplicar_pagina(&conn, reloj().ahora(), &pagina_completa()).unwrap();
    let mut p = pagina("c9", false, json!({ "gimnasio": [fila_gimnasio()], "planes": [{ "id": "pl2", "nombre": "Anual", "precio": 800000, "duracion_dias": 365, "tipo": "individual", "cupo_personas": 1, "activo": true }] }));
    p["reiniciar"] = json!(true);
    aplicar_pagina(&conn, reloj().ahora(), &p).unwrap();
    let planes: String = conn.query_row("SELECT group_concat(id) FROM planes", [], |f| f.get(0)).unwrap();
    assert_eq!(planes, "pl2");
    assert_eq!(contar(&conn, "deportistas"), 0);
}

#[test]
fn gimnasio_bloqueado_en_el_servidor_queda_anotado_y_se_levanta_con_la_siguiente_descarga_buena() {
    let (_dir, base) = base_activada();
    let t = TransporteGuion::con(vec![Err(error_servidor(403, "GIMNASIO_SUSPENDIDO", Some(json!({ "motivo": "falta_pago" }))))]);
    assert_eq!(descargar(&base, &t, &reloj()).unwrap(), ResultadoDescarga::GimnasioBloqueado);
    let leer = |base: &Mutex<Connection>| -> (bool, Option<String>) {
        base.lock().unwrap().query_row("SELECT bloqueado_por_servidor, motivo_servidor FROM suscripcion", [], |f| Ok((f.get(0)?, f.get(1)?))).unwrap()
    };
    assert_eq!(leer(&base), (true, Some("falta_pago".into())));

    t.agregar(Ok(pagina_completa()));
    descargar(&base, &t, &reloj()).unwrap();
    assert_eq!(leer(&base), (false, None));
}

#[test]
fn estacion_revocada_deja_de_descargar() {
    let (_dir, base) = base_activada();
    let t = TransporteGuion::con(vec![Err(error_servidor(401, "ESTACION_REVOCADA", None)), Ok(pagina_completa())]);
    assert_eq!(descargar(&base, &t, &reloj()).unwrap(), ResultadoDescarga::EstacionRevocada);
    // Ya revocada, ni siquiera sale a la red.
    assert_eq!(descargar(&base, &t, &reloj()).unwrap(), ResultadoDescarga::SinActivar);
    assert_eq!(t.rutas().len(), 1);
}

#[test]
fn sin_activar_no_sale_a_la_red() {
    let (_dir, conn) = base_temporal();
    let t = TransporteGuion::default();
    assert_eq!(descargar(&Mutex::new(conn), &t, &reloj()).unwrap(), ResultadoDescarga::SinActivar);
    assert!(t.rutas().is_empty());
}

// --- Fase 2: lo que la regla de acceso necesita ---

#[test]
fn llegan_congelamientos_y_pases_de_dia_y_las_fechas_quedan_en_el_formato_local() {
    let (_dir, conn) = base_temporal();
    let mut p = pagina_completa();
    p["cambios"]["membresias"][0]["created_at"] = json!("2026-11-01T13:00:00.123456+00:00");
    p["cambios"]["congelamientos"] = json!([{ "id": "c1", "membresia_id": "m1", "fecha_inicio": "2026-11-10", "fecha_fin": null }]);
    p["cambios"]["pases_dia"] = json!([
        { "id": "v1", "deportista_id": "d1", "created_at": "2026-11-12T14:00:00+00:00", "anulada": false },
        { "id": "v-viejo", "deportista_id": "d1", "created_at": "2026-11-01T14:00:00+00:00", "anulada": false }
    ]);
    aplicar_pagina(&conn, reloj().ahora(), &p).unwrap();

    let creada: String = conn.query_row("SELECT created_at FROM membresias WHERE id = 'm1'", [], |f| f.get(0)).unwrap();
    assert_eq!(creada, "2026-11-01T13:00:00.123Z");
    let (membresia, fin): (String, Option<String>) =
        conn.query_row("SELECT membresia_id, fecha_fin FROM congelamientos WHERE id = 'c1'", [], |f| Ok((f.get(0)?, f.get(1)?))).unwrap();
    assert_eq!((membresia.as_str(), fin), ("m1", None));
    // El pase de hace días ya no sirve para nada: no se guarda.
    let pases: Vec<String> = {
        let mut s = conn.prepare("SELECT id || '|' || created_at || '|' || anulada FROM pases_dia").unwrap();
        let filas = s.query_map([], |f| f.get(0)).unwrap();
        filas.collect::<Result<_, _>>().unwrap()
    };
    assert_eq!(pases, vec!["v1|2026-11-12T14:00:00.000Z|0"]);
}

#[test]
fn un_pase_anulado_y_un_congelamiento_borrado_se_reflejan_en_la_estacion() {
    let (_dir, conn) = base_temporal();
    let mut p = pagina_completa();
    p["cambios"]["congelamientos"] = json!([{ "id": "c1", "membresia_id": "m1", "fecha_inicio": "2026-11-10", "fecha_fin": null }]);
    p["cambios"]["pases_dia"] = json!([{ "id": "v1", "deportista_id": "d1", "created_at": "2026-11-12T14:00:00+00:00", "anulada": false }]);
    aplicar_pagina(&conn, reloj().ahora(), &p).unwrap();

    let mut cambio = pagina("cursor-2", false, json!({
        "pases_dia": [{ "id": "v1", "deportista_id": "d1", "created_at": "2026-11-12T14:00:00+00:00", "anulada": true }]
    }));
    cambio["eliminados"] = json!([{ "tabla": "congelamientos", "id": "c1" }]);
    aplicar_pagina(&conn, reloj().ahora(), &cambio).unwrap();

    assert_eq!(contar(&conn, "congelamientos"), 0);
    assert_eq!(contar(&conn, "pases_dia WHERE anulada = 1"), 1);
}

#[test]
fn al_actualizar_a_esta_version_la_estacion_vuelve_a_descargar_todo() {
    // Las migraciones locales 0003 y 0004 borran el cursor: la versión anterior no traía congelamientos,
    // pases ni el precio de los pases.
    let (_dir, conn) = base_temporal();
    let cursor: Option<String> = conn.query_row("SELECT cursor FROM sync_estado WHERE id = 1", [], |f| f.get(0)).unwrap();
    assert_eq!(cursor, None);
    assert_eq!(contar(&conn, "_migraciones"), 4);
}
