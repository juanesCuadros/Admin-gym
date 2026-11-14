//! Pruebas del registro de ingresos contra una base SQLCipher real.

use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::acceso::registro::*;
use crate::db::pruebas::base_temporal;
use crate::reloj::fecha_negocio;
use crate::sesion::UsuarioSesion;
use crate::sync::descarga::aplicar_pagina;
use crate::sync::pruebas_util::{fila_gimnasio, pagina, ANA};

/// Jueves 12 de noviembre de 2026, 10:00 en Bogotá.
fn ahora() -> DateTime<Utc> {
    "2026-11-12T15:00:00Z".parse().unwrap()
}

fn recepcion() -> UsuarioSesion {
    UsuarioSesion { id: ANA.into(), nombre: "Ana Ruiz".into(), correo: "ana@gimnasio.co".into(), rol: "recepcionista".into(), tiene_pin: true }
}

fn cliente(id: &str, nombre: &str, documento: &str) -> Value {
    json!({ "id": id, "tipo_documento": "CC", "documento": documento, "nombre": nombre, "activo": true, "eliminado": false })
}

fn membresia(id: &str, deportista: &str, vence: &str) -> Value {
    json!({
        "id": id, "deportista_id": deportista, "plan_id": "pl1", "fecha_inicio": "2026-01-01", "fecha_vencimiento": vence,
        "cancelada": false, "created_at": "2026-01-01T12:00:00+00:00"
    })
}

/// Base con el gimnasio (gracia 3, umbral 5), permiso de ingreso para recepción y lo que el caso agregue.
fn base(extra: Value) -> (tempfile::TempDir, Connection) {
    let (dir, conn) = base_temporal();
    let mut cambios = json!({
        "gimnasio": [fila_gimnasio()],
        "permisos": [{ "id": "p1", "rol": "recepcionista", "submodulo": "control_ingreso", "puede_crear": true, "puede_leer": true, "puede_editar": false, "puede_eliminar": false }],
        "planes": [{ "id": "pl1", "nombre": "Mensual", "precio": 80000, "duracion_dias": 30, "tipo": "individual", "cupo_personas": 1, "activo": true }],
    });
    for (tabla, filas) in extra.as_object().unwrap() {
        cambios[tabla] = filas.clone();
    }
    aplicar_pagina(&conn, ahora(), &pagina("c1", false, cambios)).unwrap();
    (dir, conn)
}

fn contar(conn: &Connection, consulta: &str) -> i64 {
    conn.query_row(&format!("SELECT count(*) FROM {consulta}"), [], |f| f.get(0)).unwrap()
}

fn entrar(conn: &Connection, cuando: DateTime<Utc>, documento: &str) -> ResultadoIngreso {
    registrar_ingreso(conn, cuando, &recepcion(), Objetivo::Documento(documento), "manual").unwrap()
}

#[test]
fn un_cliente_al_dia_entra_y_el_ingreso_queda_guardado_junto_con_su_operacion_en_la_cola() {
    let (_d, conn) = base(json!({
        "deportistas": [cliente("d1", "Luis Pérez", "1002003004")],
        "membresias": [membresia("m1", "d1", "2026-12-20")]
    }));
    let cola_antes = contar(&conn, "sync_outbox");

    let r = entrar(&conn, ahora(), " 1002003004 ");
    assert!(r.abre && !r.relectura_ignorada);
    assert_eq!((r.resultado.as_str(), r.mensaje.as_str()), ("abrio", "Membresía activa"));
    let c = r.cliente.unwrap();
    assert_eq!((c.nombre.as_str(), c.estado, c.dias_restantes_o_vencido), ("Luis Pérez", "activo", 38));
    assert_eq!((c.plan_nombre.as_deref(), c.fecha_vencimiento.as_deref()), (Some("Mensual"), Some("2026-12-20")));

    let id = r.id.unwrap();
    let (resultado, nombre, fecha): (String, String, String) = conn
        .query_row("SELECT resultado, deportista_nombre, fecha_negocio FROM ingresos WHERE id = ?1", [&id], |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)))
        .unwrap();
    assert_eq!((resultado.as_str(), nombre.as_str(), fecha.as_str()), ("abrio", "Luis Pérez", "2026-11-12"));

    assert_eq!(contar(&conn, "sync_outbox"), cola_antes + 1);
    let (tipo, staff, ocurrida, payload): (String, String, String, String) = conn
        .query_row("SELECT tipo, staff_id, ocurrida_en, payload FROM sync_outbox WHERE id = ?1", [&id], |f| {
            Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?))
        })
        .unwrap();
    assert_eq!((tipo.as_str(), staff.as_str(), ocurrida.as_str()), ("ingreso", ANA, "2026-11-12T15:00:00.000Z"));
    assert_eq!(
        serde_json::from_str::<Value>(&payload).unwrap(),
        json!({ "deportista_id": "d1", "metodo": "manual", "resultado": "abrio", "estado": "activo", "con_pase_dia": false })
    );
}

#[test]
fn una_relectura_dentro_de_3_segundos_no_se_registra_y_despues_si() {
    let (_d, conn) = base(json!({
        "deportistas": [cliente("d1", "Luis Pérez", "1002003004"), cliente("d2", "Marta Díaz", "55")],
        "membresias": [membresia("m1", "d1", "2026-12-20"), membresia("m2", "d2", "2026-12-20")]
    }));
    assert!(entrar(&conn, ahora(), "1002003004").abre);

    let rebote = entrar(&conn, ahora() + Duration::milliseconds(2900), "1002003004");
    assert!(rebote.relectura_ignorada && !rebote.abre && rebote.id.is_none());
    assert_eq!(rebote.resultado, "abrio");
    assert_eq!(contar(&conn, "ingresos"), 1);

    // Otra persona en ese mismo instante sí entra: el antirrebote es por cliente.
    assert!(entrar(&conn, ahora() + Duration::milliseconds(2900), "55").abre);
    // A los 3 segundos ya cuenta como un ingreso nuevo.
    assert!(!entrar(&conn, ahora() + Duration::seconds(3), "1002003004").relectura_ignorada);
    assert_eq!(contar(&conn, "ingresos"), 3);
    assert_eq!(contar(&conn, "sync_outbox WHERE tipo = 'ingreso'"), 3);
}

#[test]
fn un_intento_negado_tambien_queda_registrado() {
    let (_d, conn) = base(json!({
        "deportistas": [cliente("d1", "Luis Pérez", "1002003004")],
        "membresias": [membresia("m1", "d1", "2026-11-01")]
    }));
    let r = entrar(&conn, ahora(), "1002003004");
    assert!(!r.abre);
    assert_eq!((r.resultado.as_str(), r.mensaje.as_str()), ("negado", "Membresía vencida hace 11 días"));
    assert_eq!(contar(&conn, "ingresos WHERE resultado = 'negado'"), 1);
    assert_eq!(contar(&conn, "sync_outbox WHERE tipo = 'ingreso'"), 1);
}

#[test]
fn en_gracia_entra_con_alerta_y_congelado_no_entra() {
    let (_d, conn) = base(json!({
        "deportistas": [cliente("d1", "En Gracia", "1"), cliente("d2", "Congelada", "2"), cliente("d3", "Descongelada", "3")],
        "membresias": [membresia("m1", "d1", "2026-11-10"), membresia("m2", "d2", "2026-12-20"), membresia("m3", "d3", "2026-12-20")],
        "congelamientos": [
            { "id": "c2", "membresia_id": "m2", "fecha_inicio": "2026-11-12", "fecha_fin": null },
            // Terminó hoy: fecha_fin no es mayor que hoy, ya no está congelada.
            { "id": "c3", "membresia_id": "m3", "fecha_inicio": "2026-11-01", "fecha_fin": "2026-11-12" }
        ]
    }));
    let gracia = entrar(&conn, ahora(), "1");
    assert!(gracia.abre);
    assert_eq!((gracia.resultado.as_str(), gracia.cliente.unwrap().dias_restantes_o_vencido), ("alerta_mora", 2));

    let congelada = entrar(&conn, ahora(), "2");
    assert!(!congelada.abre);
    assert_eq!(congelada.cliente.unwrap().estado, "congelado");

    assert!(entrar(&conn, ahora(), "3").abre);
}

#[test]
fn se_elige_la_membresia_sin_cancelar_que_vence_mas_tarde_y_si_empatan_la_mas_nueva() {
    let mut vieja = membresia("m-vencida", "d1", "2026-10-01");
    vieja["created_at"] = json!("2026-11-11T12:00:00+00:00"); // creada después, pero vence antes
    let mut cancelada = membresia("m-cancelada", "d1", "2027-06-01");
    cancelada["cancelada"] = json!(true);
    let mut empate_vieja = membresia("m-a", "d2", "2026-12-01");
    empate_vieja["plan_id"] = json!("pl-viejo");
    let mut empate_nueva = membresia("m-b", "d2", "2026-12-01");
    empate_nueva["created_at"] = json!("2026-06-01T12:00:00.5+00:00");
    let (_d, conn) = base(json!({
        "planes": [
            { "id": "pl1", "nombre": "Mensual", "precio": 80000, "duracion_dias": 30, "tipo": "individual", "cupo_personas": 1, "activo": true },
            { "id": "pl-viejo", "nombre": "Plan Viejo", "precio": 1, "duracion_dias": 30, "tipo": "individual", "cupo_personas": 1, "activo": true }
        ],
        "deportistas": [cliente("d1", "Luis Pérez", "1"), cliente("d2", "Marta Díaz", "2"), cliente("d3", "Solo Cancelada", "3")],
        "membresias": [vieja, membresia("m-vigente", "d1", "2026-12-20"), cancelada, empate_vieja, empate_nueva, {
            "id": "m-c", "deportista_id": "d3", "plan_id": "pl1", "fecha_inicio": "2026-01-01", "fecha_vencimiento": "2026-12-20",
            "cancelada": true, "created_at": "2026-01-01T12:00:00+00:00"
        }]
    }));
    let hoy = fecha_negocio(ahora());

    let luis = evaluar_cliente(&conn, "d1", hoy).unwrap().unwrap();
    assert_eq!((luis.estado, luis.fecha_vencimiento.as_deref()), ("activo", Some("2026-12-20")));
    let marta = evaluar_cliente(&conn, "d2", hoy).unwrap().unwrap();
    assert_eq!(marta.plan_nombre.as_deref(), Some("Mensual"));
    let cancelada = evaluar_cliente(&conn, "d3", hoy).unwrap().unwrap();
    assert_eq!((cancelada.estado, cancelada.abre), ("cancelado", false));
}

#[test]
fn un_pase_de_dia_pagado_hoy_deja_entrar_pero_no_uno_anulado_ni_de_ayer_ni_a_un_desactivado() {
    let mut desactivado = cliente("d4", "Desactivado", "4");
    desactivado["activo"] = json!(false);
    let (_d, conn) = base(json!({
        "deportistas": [cliente("d1", "Con Pase", "1"), cliente("d2", "Pase Anulado", "2"), cliente("d3", "Pase De Ayer", "3"), desactivado],
        "pases_dia": [
            { "id": "v1", "deportista_id": "d1", "created_at": "2026-11-12T13:00:00+00:00", "anulada": false },
            { "id": "v2", "deportista_id": "d2", "created_at": "2026-11-12T13:00:00+00:00", "anulada": true },
            // 04:59 UTC del 12 todavía es 11 de noviembre en Bogotá.
            { "id": "v3", "deportista_id": "d3", "created_at": "2026-11-12T04:59:00+00:00", "anulada": false },
            { "id": "v4", "deportista_id": "d4", "created_at": "2026-11-12T13:00:00+00:00", "anulada": false }
        ]
    }));
    let con_pase = entrar(&conn, ahora(), "1");
    assert!(con_pase.abre);
    assert_eq!((con_pase.resultado.as_str(), con_pase.mensaje.as_str()), ("abrio", "Ingreso con pase de día vigente hoy."));
    let c = con_pase.cliente.unwrap();
    assert_eq!((c.estado, c.con_pase_dia), ("sin_membresia", true));
    let payload: String = conn.query_row("SELECT payload FROM sync_outbox WHERE tipo = 'ingreso'", [], |f| f.get(0)).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&payload).unwrap()["con_pase_dia"], json!(true));

    for documento in ["2", "3", "4"] {
        assert!(!entrar(&conn, ahora(), documento).abre, "documento {documento}");
    }
}

#[test]
fn el_dia_que_cuenta_es_el_de_bogota() {
    let (_d, conn) = base(json!({
        "deportistas": [cliente("d1", "Luis Pérez", "1")],
        "membresias": [membresia("m1", "d1", "2026-11-12")]
    }));
    // 00:30 UTC del 13 son las 19:30 del 12 en Bogotá: vence hoy, todavía no está en mora.
    let noche: DateTime<Utc> = "2026-11-13T00:30:00Z".parse().unwrap();
    let r = entrar(&conn, noche, "1");
    assert_eq!((r.resultado.as_str(), r.cliente.unwrap().estado), ("abrio", "por_vencer"));
    let fecha: String = conn.query_row("SELECT fecha_negocio FROM ingresos", [], |f| f.get(0)).unwrap();
    assert_eq!(fecha, "2026-11-12");
}

#[test]
fn un_documento_que_no_existe_o_un_cliente_eliminado_no_registra_nada() {
    let mut eliminado = cliente("d2", "Eliminado", "2");
    eliminado["eliminado"] = json!(true);
    let (_d, conn) = base(json!({ "deportistas": [cliente("d1", "Luis Pérez", "1"), eliminado] }));
    for objetivo in [Objetivo::Documento("999"), Objetivo::Documento("2"), Objetivo::Id("no-existe")] {
        let e = registrar_ingreso(&conn, ahora(), &recepcion(), objetivo, "manual").unwrap_err();
        assert_eq!(e.codigo, "CLIENTE_NO_ENCONTRADO");
    }
    assert_eq!(contar(&conn, "ingresos"), 0);
}

#[test]
fn sin_permiso_de_control_de_ingreso_no_se_registra_y_el_jefe_siempre_puede() {
    let (_d, conn) = base(json!({
        "deportistas": [cliente("d1", "Luis Pérez", "1")],
        "membresias": [membresia("m1", "d1", "2026-12-20")]
    }));
    let mut entrenador = recepcion();
    entrenador.rol = "entrenador".into();
    let e = registrar_ingreso(&conn, ahora(), &entrenador, Objetivo::Documento("1"), "manual").unwrap_err();
    assert_eq!(e.codigo, "PERMISO_DENEGADO");
    assert_eq!(registrar_cortesia(&conn, ahora(), &entrenador, "Invitado del dueño").unwrap_err().codigo, "PERMISO_DENEGADO");
    assert_eq!(contar(&conn, "ingresos"), 0);

    let mut jefe = recepcion();
    jefe.rol = "jefe".into();
    assert!(registrar_ingreso(&conn, ahora(), &jefe, Objetivo::Id("d1"), "manual").unwrap().abre);
}

#[test]
fn la_cortesia_exige_motivo_y_queda_en_la_cola_y_en_la_auditoria_local() {
    let (_d, conn) = base(json!({}));
    for motivo in ["", "   ", "ok ", " abc "] {
        assert_eq!(registrar_cortesia(&conn, ahora(), &recepcion(), motivo).unwrap_err().codigo, "MOTIVO_REQUERIDO");
    }
    assert_eq!(contar(&conn, "ingresos"), 0);

    let r = registrar_cortesia(&conn, ahora(), &recepcion(), "  Invitado del dueño ").unwrap();
    assert!(r.abre && r.cliente.is_none());
    assert_eq!(r.tipo, "cortesia");
    let id = r.id.unwrap();
    let motivo: String = conn.query_row("SELECT motivo_cortesia FROM ingresos WHERE id = ?1", [&id], |f| f.get(0)).unwrap();
    assert_eq!(motivo, "Invitado del dueño");
    let payload: String = conn.query_row("SELECT payload FROM sync_outbox WHERE id = ?1 AND tipo = 'cortesia'", [&id], |f| f.get(0)).unwrap();
    assert_eq!(serde_json::from_str::<Value>(&payload).unwrap(), json!({ "motivo": "Invitado del dueño" }));
    assert_eq!(contar(&conn, "auditoria_local WHERE accion = 'INGRESO_CORTESIA'"), 1);
}

#[test]
fn los_ingresos_registrados_no_se_pueden_borrar() {
    let (_d, conn) = base(json!({}));
    registrar_cortesia(&conn, ahora(), &recepcion(), "Invitado del dueño").unwrap();
    assert!(conn.execute("DELETE FROM ingresos", []).is_err());
    assert_eq!(contar(&conn, "ingresos"), 1);
}

#[test]
fn la_busqueda_ignora_tildes_y_mayusculas_y_pone_primero_el_documento_exacto() {
    let mut eliminado = cliente("d9", "José Eliminado", "900");
    eliminado["eliminado"] = json!(true);
    let (_d, conn) = base(json!({
        "deportistas": [cliente("d1", "José Peñaloza", "1002"), cliente("d2", "Marta Díaz", "100"), cliente("d3", "Josefina Ruiz", "777"), eliminado],
        "membresias": [membresia("m1", "d1", "2026-12-20")]
    }));
    let hoy = fecha_negocio(ahora());
    let nombres = |texto: &str| -> Vec<String> { buscar(&conn, texto, hoy).unwrap().into_iter().map(|c| c.nombre).collect() };

    assert_eq!(nombres("JOSE"), vec!["José Peñaloza", "Josefina Ruiz"]);
    assert_eq!(nombres("penaloza jose"), vec!["José Peñaloza"]);
    // "100" es el documento exacto de Marta y el comienzo del de José.
    assert_eq!(nombres("100"), vec!["Marta Díaz", "José Peñaloza"]);
    assert!(nombres("j").is_empty(), "con una sola letra no se busca");
    // Cada resultado ya trae su estado para mostrarlo antes de registrar.
    let jose = &buscar(&conn, "1002", hoy).unwrap()[0];
    assert_eq!((jose.estado, jose.abre), ("activo", true));
}

#[test]
fn el_resumen_del_dia_cuenta_solo_lo_de_hoy_y_avisa_si_el_reloj_retrocedio() {
    let (_d, conn) = base(json!({
        "deportistas": [cliente("d1", "Al Día", "1"), cliente("d2", "Vencido", "2")],
        "membresias": [membresia("m1", "d1", "2026-12-20"), membresia("m2", "d2", "2026-10-01")]
    }));
    entrar(&conn, ahora() - Duration::days(1), "1");
    entrar(&conn, ahora(), "1");
    entrar(&conn, ahora() + Duration::seconds(10), "2");
    registrar_cortesia(&conn, ahora() + Duration::seconds(20), &recepcion(), "Invitado del dueño").unwrap();

    let r = ingresos_del_dia(&conn, ahora() + Duration::seconds(30)).unwrap();
    assert_eq!((r.fecha.as_str(), r.total, r.abrieron, r.alertas, r.negados, r.cortesias), ("2026-11-12", 3, 1, 0, 1, 1));
    assert_eq!(r.items.iter().map(|i| i.tipo.as_str()).collect::<Vec<_>>(), vec!["cortesia", "ingreso", "ingreso"]);
    assert!(r.items.iter().all(|i| i.envio == "pendiente"));
    assert!(!r.reloj_retrocedio);

    // Alguien atrasó el reloj del equipo dos horas.
    assert!(ingresos_del_dia(&conn, ahora() - Duration::hours(2)).unwrap().reloj_retrocedio);
}
