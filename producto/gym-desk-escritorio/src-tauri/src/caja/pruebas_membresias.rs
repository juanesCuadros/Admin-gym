//! Pruebas de vender y renovar membresías en la estación, contra una base SQLCipher real.

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::acceso::registro::evaluar_cliente;
use crate::caja::membresias::{cobrar, opciones, NuevoCobroMembresia};
use crate::caja::*;
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

fn permiso(submodulo: &str, crear: bool, editar: bool) -> Value {
    json!({ "id": format!("p-{submodulo}"), "rol": "recepcionista", "submodulo": submodulo, "puede_crear": crear, "puede_leer": true,
            "puede_editar": editar, "puede_eliminar": false })
}

fn membresia(id: &str, deportista: &str, vence: &str) -> Value {
    json!({ "id": id, "deportista_id": deportista, "plan_id": "mes", "fecha_inicio": "2026-10-01", "fecha_vencimiento": vence,
            "cancelada": false, "created_at": "2026-10-01T15:00:00Z", "plan_precio_vendido": 70000 })
}

/// Gimnasio con 3 días de gracia y descuentos hasta 20 %. Plan mensual (hoy cuesta 80.000; Luis lo compró a 70.000),
/// plan trimestral y plan de pareja. Luis tiene membresía, Marta vencida, Carlos ninguna.
fn base(vence_luis: &str, caja_editar: bool) -> (tempfile::TempDir, Connection) {
    let (dir, conn) = base_temporal();
    let mut g = fila_gimnasio();
    g["permitir_descuentos"] = json!(true);
    g["tope_descuento_pct"] = json!(20);
    g["metodos_pago"] = json!(["Efectivo", "Nequi"]);
    let cambios = json!({
        "gimnasio": [g],
        "permisos": [permiso("caja", true, caja_editar), permiso("control_ingreso", true, false)],
        "planes": [
            { "id": "mes", "nombre": "Mensual", "precio": 80000, "duracion_dias": 30, "tipo": "individual", "cupo_personas": 1, "activo": true },
            { "id": "tri", "nombre": "Trimestral", "precio": 210000, "duracion_dias": 90, "tipo": "individual", "cupo_personas": 1, "activo": true },
            { "id": "par", "nombre": "Pareja", "precio": 140000, "duracion_dias": 30, "tipo": "pareja", "cupo_personas": 2, "activo": true }
        ],
        "deportistas": [
            { "id": "luis", "tipo_documento": "CC", "documento": "1001", "nombre": "Luis Pérez", "activo": true, "eliminado": false },
            { "id": "marta", "tipo_documento": "CC", "documento": "1002", "nombre": "Marta Gil", "activo": true, "eliminado": false },
            { "id": "carlos", "tipo_documento": "CC", "documento": "1003", "nombre": "Carlos Díaz", "activo": true, "eliminado": false }
        ],
        "membresias": [membresia("m-luis", "luis", vence_luis), membresia("m-marta", "marta", "2026-11-05")],
    });
    aplicar_pagina(&conn, ahora(), &pagina("c1", false, cambios)).unwrap();
    conn.execute(
        "INSERT INTO staff_local (id, nombre, correo, rol, activo, eliminado, actualizado_en) VALUES (?1, 'Ana Ruiz', 'ana@gimnasio.co', 'recepcionista', 1, 0, '')",
        [ANA],
    )
    .unwrap();
    (dir, conn)
}

fn renovar(deportista: &str, metodo: &str) -> NuevoCobroMembresia {
    NuevoCobroMembresia {
        deportista_id: deportista.into(), accion: "renovar".into(), plan_id: None, precio_cobrado: None, motivo_descuento: None,
        metodo: Some(metodo.into()), pagos: None, valor_recibido: None, nota: None,
    }
}

fn vender(deportista: &str, plan: &str) -> NuevoCobroMembresia {
    NuevoCobroMembresia { accion: "vender".into(), plan_id: Some(plan.into()), ..renovar(deportista, "Efectivo") }
}

fn vencimiento(conn: &Connection, membresia: &str) -> String {
    conn.query_row("SELECT fecha_vencimiento FROM membresias WHERE id = ?1", [membresia], |f| f.get(0)).unwrap()
}

fn codigo<T: std::fmt::Debug>(r: Resultado<T>) -> String {
    r.unwrap_err().codigo
}

#[test]
fn renovar_una_vigente_suma_desde_el_vencimiento_al_precio_vendido_y_entra_al_arqueo() {
    let (_d, conn) = base("2026-11-20", false);
    let yo = recepcion();
    let t = abrir_turno(&conn, ahora(), &yo, 50_000, Confirmacion::Confirmada).unwrap();

    let op = opciones(&conn, "luis", fecha_negocio(ahora())).unwrap();
    let r = op.renovacion.as_ref().unwrap();
    assert_eq!((r.precio_lista, r.dias, r.fecha_vencimiento_nueva.as_str()), (70000, 30, "2026-12-20"));
    assert!(op.planes.is_empty());

    let c = cobrar(&conn, ahora(), &yo, &NuevoCobroMembresia { valor_recibido: Some(100_000), ..renovar("luis", "Efectivo") }).unwrap();
    assert_eq!((c.tipo.as_str(), c.precio_cobrado, c.cambio, c.fecha_vencimiento_nueva.as_str()), ("renovacion", 70000, Some(30_000), "2026-12-20"));
    assert_eq!(vencimiento(&conn, "m-luis"), "2026-12-20");

    let tot = totales(&conn, &t.turno.id).unwrap();
    assert_eq!((tot.membresias_efectivo, tot.num_membresias, tot.total_esperado_efectivo), (70000, 1, 120_000));

    let (tipo, deps, payload): (String, String, String) = conn
        .query_row("SELECT tipo, depende_de, payload FROM sync_outbox WHERE id = ?1", [&c.id], |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)))
        .unwrap();
    let p: Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(tipo, "membresia_renovar");
    assert_eq!(deps, json!([t.turno.id]).to_string());
    assert_eq!(p["fecha_vencimiento_anterior"], "2026-11-20");
    assert_eq!(p["fecha_vencimiento_nueva"], "2026-12-20");
    assert_eq!((p["precio_lista"].as_i64(), p["dias"].as_i64(), p["membresia_id"].as_str()), (Some(70000), Some(30), Some("m-luis")));

    let movs = movimientos(&conn, &t.turno.id).unwrap();
    assert_eq!(movs[0].concepto, "Renovación Mensual · Luis Pérez");
}

#[test]
fn renovar_una_vencida_cuenta_desde_hoy_salvo_que_haya_entrado_en_gracia() {
    let (_d, conn) = base("2026-11-20", false);
    let yo = recepcion();
    abrir_turno(&conn, ahora(), &yo, 0, Confirmacion::Confirmada).unwrap();
    // Marta venció el 5 y no entró en la gracia (6 al 8): cuenta desde hoy, 12 de noviembre.
    let c = cobrar(&conn, ahora(), &yo, &renovar("marta", "Nequi")).unwrap();
    assert_eq!(c.fecha_vencimiento_nueva, "2026-12-12");
    assert_eq!(c.tipo_medio, "otro");

    // Si hubiera entrado el 7, cuenta desde el vencimiento.
    let (_d2, conn2) = base("2026-11-20", false);
    conn2
        .execute(
            "INSERT INTO ingresos (id, tipo, deportista_id, metodo, resultado, mensaje, staff_id, ocurrido_en, fecha_negocio)
             VALUES ('i1', 'ingreso', 'marta', 'manual', 'alerta_mora', 'gracia', ?1, '2026-11-07T15:00:00.000Z', '2026-11-07')",
            [ANA],
        )
        .unwrap();
    let op = opciones(&conn2, "marta", fecha_negocio(ahora())).unwrap();
    assert_eq!(op.renovacion.unwrap().fecha_vencimiento_nueva, "2026-12-05");
}

#[test]
fn vender_crea_la_membresia_local_y_el_cliente_entra_de_una_vez() {
    let (_d, conn) = base("2026-11-20", false);
    let yo = recepcion();
    let t = abrir_turno(&conn, ahora(), &yo, 0, Confirmacion::Confirmada).unwrap();
    let hoy = fecha_negocio(ahora());
    assert!(!evaluar_cliente(&conn, "carlos", hoy).unwrap().unwrap().abre);

    let op = opciones(&conn, "carlos", hoy).unwrap();
    assert!(op.renovacion.is_none());
    // Solo planes individuales: el de pareja se vende en la web.
    assert_eq!(op.planes.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["mes", "tri"]);

    let c = cobrar(&conn, ahora(), &yo, &vender("carlos", "tri")).unwrap();
    assert_eq!((c.tipo.as_str(), c.precio_cobrado, c.fecha_vencimiento_nueva.as_str()), ("venta", 210_000, "2027-02-10"));
    let e = evaluar_cliente(&conn, "carlos", hoy).unwrap().unwrap();
    assert!(e.abre);
    assert_eq!(e.plan_nombre.as_deref(), Some("Trimestral"));

    let (tipo, payload): (String, String) =
        conn.query_row("SELECT tipo, payload FROM sync_outbox WHERE id = ?1", [&c.id], |f| Ok((f.get(0)?, f.get(1)?))).unwrap();
    let p: Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(tipo, "membresia_vender");
    assert_eq!((p["plan_id"].as_str(), p["fecha_inicio"].as_str(), p["membresia_id"].as_str()), (Some("tri"), Some("2026-11-12"), Some(c.membresia_id.as_str())));
    assert_eq!(totales(&conn, &t.turno.id).unwrap().total_esperado_efectivo, 210_000);

    // Ya tiene membresía: ahora solo se renueva.
    assert_eq!(codigo(cobrar(&conn, ahora(), &yo, &vender("carlos", "mes"))), "MEMBRESIA_EXISTENTE");
    assert_eq!(codigo(cobrar(&conn, ahora(), &yo, &vender("marta", "mes"))), "MEMBRESIA_EXISTENTE");
    assert_eq!(codigo(cobrar(&conn, ahora(), &yo, &vender("luis", "par"))), "MEMBRESIA_EXISTENTE");
}

#[test]
fn la_descarga_no_deshace_lo_que_aun_no_subio_y_despues_manda_el_servidor() {
    let (_d, conn) = base("2026-11-20", false);
    let yo = recepcion();
    abrir_turno(&conn, ahora(), &yo, 0, Confirmacion::Confirmada).unwrap();
    let r = cobrar(&conn, ahora(), &yo, &renovar("luis", "Efectivo")).unwrap();
    let v = cobrar(&conn, ahora(), &yo, &vender("carlos", "mes")).unwrap();

    // Llega una descarga con la membresía vieja, y además el servidor pide reiniciar: nada se pierde.
    let mut p = pagina("c2", false, json!({ "membresias": [membresia("m-luis", "luis", "2026-11-20")] }));
    aplicar_pagina(&conn, ahora(), &p).unwrap();
    assert_eq!(vencimiento(&conn, "m-luis"), "2026-12-20");
    p["reiniciar"] = json!(true);
    p["cambios"]["membresias"] = json!([membresia("m-luis", "luis", "2026-11-20"), membresia("m-marta", "marta", "2026-11-05")]);
    aplicar_pagina(&conn, ahora(), &p).unwrap();
    assert_eq!(vencimiento(&conn, "m-luis"), "2026-12-20");
    assert_eq!(vencimiento(&conn, &v.membresia_id), "2026-12-12");

    // Ya subieron: lo que diga el servidor manda (aquí corrigió la fecha de Luis).
    conn.execute("UPDATE sync_outbox SET estado = 'aplicada' WHERE id IN (?1, ?2)", [&r.id, &v.id]).unwrap();
    aplicar_pagina(&conn, ahora(), &pagina("c3", false, json!({ "membresias": [membresia("m-luis", "luis", "2026-12-21")] }))).unwrap();
    assert_eq!(vencimiento(&conn, "m-luis"), "2026-12-21");
}

#[test]
fn descuento_y_pago_mixto_siguen_las_reglas_de_la_caja() {
    let (_d, conn) = base("2026-11-20", false);
    let yo = recepcion();
    let t = abrir_turno(&conn, ahora(), &yo, 0, Confirmacion::Confirmada).unwrap();
    let con_descuento = NuevoCobroMembresia { precio_cobrado: Some(60000), motivo_descuento: Some("Cliente antiguo".into()), ..renovar("luis", "Efectivo") };
    assert_eq!(codigo(cobrar(&conn, ahora(), &yo, &con_descuento)), "SIN_PERMISO_DESCUENTO");

    let (_d2, conn2) = base("2026-11-20", true);
    abrir_turno(&conn2, ahora(), &yo, 0, Confirmacion::Confirmada).unwrap();
    // 70.000 → 50.000 es 28,6 %: supera el tope de 20 %.
    let mucho = NuevoCobroMembresia { precio_cobrado: Some(50000), ..con_descuento.clone() };
    assert_eq!(codigo(cobrar(&conn2, ahora(), &yo, &mucho)), "DESCUENTO_SUPERA_TOPE");
    let sin_motivo = NuevoCobroMembresia { motivo_descuento: None, ..con_descuento.clone() };
    assert_eq!(codigo(cobrar(&conn2, ahora(), &yo, &sin_motivo)), "MOTIVO_DESCUENTO_REQUERIDO");
    assert_eq!(cobrar(&conn2, ahora(), &yo, &con_descuento).unwrap().precio_cobrado, 60000);

    // Mixto: 30.000 en efectivo y 40.000 por Nequi.
    let mixto = NuevoCobroMembresia {
        metodo: None,
        pagos: Some(vec![NuevoMedio { metodo: "Efectivo".into(), monto: 30000 }, NuevoMedio { metodo: "Nequi".into(), monto: 40000 }]),
        valor_recibido: Some(50000),
        ..renovar("marta", "Efectivo")
    };
    let c = cobrar(&conn, ahora(), &yo, &mixto).unwrap();
    assert_eq!((c.tipo_medio.as_str(), c.cambio), ("mixto", Some(20000)));
    let tot = totales(&conn, &t.turno.id).unwrap();
    assert_eq!((tot.membresias_efectivo, tot.membresias_otro, tot.total_esperado_efectivo), (30000, 40000, 30000));
}

#[test]
fn sin_turno_abierto_no_se_cobra() {
    let (_d, conn) = base("2026-11-20", false);
    assert_eq!(codigo(cobrar(&conn, ahora(), &recepcion(), &renovar("luis", "Efectivo"))), "NO_HAY_TURNO_ABIERTO");
}
