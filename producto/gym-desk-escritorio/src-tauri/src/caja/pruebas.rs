//! Pruebas de la caja contra una base SQLCipher real.

use chrono::{DateTime, Duration, Utc};
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::acceso::registro::{registrar_ingreso, Objetivo};
use crate::caja::*;
use crate::db::pruebas::base_temporal;
use crate::sesion::UsuarioSesion;
use crate::sync::descarga::aplicar_pagina;
use crate::sync::outbox::{self, OperacionEnviada};
use crate::sync::pruebas_util::{fila_gimnasio, pagina, ANA};

/// Jueves 12 de noviembre de 2026, 10:00 en Bogotá.
fn ahora() -> DateTime<Utc> {
    "2026-11-12T15:00:00Z".parse().unwrap()
}

fn recepcion() -> UsuarioSesion {
    UsuarioSesion { id: ANA.into(), nombre: "Ana Ruiz".into(), correo: "ana@gimnasio.co".into(), rol: "recepcionista".into(), tiene_pin: true }
}

fn jefe() -> UsuarioSesion {
    UsuarioSesion { id: "j1".into(), nombre: "Jefe".into(), correo: "jefe@gimnasio.co".into(), rol: "jefe".into(), tiene_pin: true }
}

fn permiso(submodulo: &str, crear: bool, editar: bool) -> Value {
    json!({ "id": format!("p-{submodulo}"), "rol": "recepcionista", "submodulo": submodulo, "puede_crear": crear, "puede_leer": true,
            "puede_editar": editar, "puede_eliminar": false })
}

/// Gimnasio con descuentos hasta 20 %, pase de día a 15.000, pase de clase sin precio, dos productos y un cliente.
fn base(caja_crear: bool, caja_editar: bool) -> (tempfile::TempDir, Connection) {
    let (dir, conn) = base_temporal();
    let mut g = fila_gimnasio();
    g["permitir_descuentos"] = json!(true);
    g["tope_descuento_pct"] = json!(20);
    g["precio_pase_dia"] = json!(15000);
    g["metodos_pago"] = json!(["Efectivo", "Nequi", "Datáfono"]);
    let cambios = json!({
        "gimnasio": [g],
        "permisos": [permiso("caja", caja_crear, caja_editar), permiso("control_ingreso", true, false)],
        "productos": [
            { "id": "agua", "nombre": "Agua 600 ml", "precio": 3000, "stock": 5, "activo": true },
            { "id": "proteina", "nombre": "Proteína", "precio": 10000, "stock": 2, "activo": true },
            { "id": "viejo", "nombre": "Gorra", "precio": 20000, "stock": 9, "activo": false }
        ],
        "deportistas": [{ "id": "d1", "tipo_documento": "CC", "documento": "1001", "nombre": "Luis Pérez", "activo": true, "eliminado": false }],
    });
    aplicar_pagina(&conn, ahora(), &pagina("c1", false, cambios)).unwrap();
    conn.execute(
        "INSERT INTO staff_local (id, nombre, correo, rol, activo, eliminado, actualizado_en) VALUES (?1, 'Ana Ruiz', 'ana@gimnasio.co', 'recepcionista', 1, 0, '')",
        [ANA],
    )
    .unwrap();
    (dir, conn)
}

fn producto(id: &str, cantidad: i64) -> NuevoItem {
    NuevoItem { tipo: "producto".into(), producto_id: Some(id.into()), cantidad, precio: None, precio_cobrado: None, motivo_descuento: None }
}

fn pase(tipo: &str, precio: Option<i64>) -> NuevoItem {
    NuevoItem { tipo: tipo.into(), producto_id: None, cantidad: 1, precio, precio_cobrado: None, motivo_descuento: None }
}

fn en(metodo: &str, items: Vec<NuevoItem>) -> NuevaVenta {
    NuevaVenta { deportista_id: None, items, metodo: Some(metodo.into()), pagos: None, valor_recibido: None }
}

fn cola(conn: &Connection) -> Vec<(String, String, String)> {
    // Sin los eventos de sesión de la estación (la base nueva ya trae CREAR_BASE_LOCAL).
    let mut stmt = conn
        .prepare("SELECT tipo, depende_de, payload FROM sync_outbox WHERE tipo <> 'auditoria_estacion' ORDER BY secuencia")
        .unwrap();
    let filas = stmt.query_map([], |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?))).unwrap();
    filas.map(|f| f.unwrap()).collect()
}

fn codigo<T: std::fmt::Debug>(r: Resultado<T>) -> String {
    r.unwrap_err().codigo
}

#[test]
fn un_turno_completo_cuadra_peso_por_peso_y_cada_movimiento_queda_en_la_cola_con_su_turno() {
    let (_d, conn) = base(true, false);
    let yo = recepcion();
    let t = abrir_turno(&conn, ahora(), &yo, 50_000, Confirmacion::Confirmada).unwrap();
    assert!(!t.turno.sin_confirmar);
    assert_eq!(t.totales.total_esperado_efectivo, 50_000);

    // Efectivo con cambio
    let mut v = en("Efectivo", vec![producto("agua", 2)]);
    v.valor_recibido = Some(10_000);
    let r = registrar_venta(&conn, ahora(), &yo, &v).unwrap();
    assert_eq!((r.total, r.cambio, r.tipo_medio.as_str()), (6_000, Some(4_000), "efectivo"));
    // Pase de día a un cliente, pago mixto
    let mut v = en("", vec![pase("pase_dia", None)]);
    v.deportista_id = Some("d1".into());
    v.metodo = None;
    v.pagos = Some(vec![NuevoMedio { metodo: "Efectivo".into(), monto: 5_000 }, NuevoMedio { metodo: "Nequi".into(), monto: 10_000 }]);
    v.valor_recibido = Some(5_000);
    let r = registrar_venta(&conn, ahora(), &yo, &v).unwrap();
    assert_eq!((r.total, r.tipo_medio.as_str(), r.cambio), (15_000, "mixto", Some(0)));
    // Pase de clase sin precio configurado: se escribe al cobrar
    registrar_venta(&conn, ahora(), &yo, &en("Datáfono", vec![pase("pase_clase", Some(12_000))])).unwrap();
    registrar_egreso(&conn, ahora(), &yo, 8_000, "Compra de hielo").unwrap();

    let tot = totales(&conn, &t.turno.id).unwrap();
    assert_eq!((tot.ventas_efectivo, tot.ventas_otro, tot.egresos_efectivo), (11_000, 22_000, 8_000));
    assert_eq!(tot.total_esperado_efectivo, 53_000);
    assert_eq!(
        tot.por_metodo.iter().map(|p| (p.metodo.as_str(), p.monto)).collect::<Vec<_>>(),
        vec![("Datáfono", 12_000), ("Efectivo", 11_000), ("Nequi", 10_000)]
    );
    assert_eq!(movimientos(&conn, &t.turno.id).unwrap().len(), 4);

    let c = cerrar_turno(&conn, ahora() + Duration::hours(8), &yo, 52_000, Some("Faltó una moneda")).unwrap();
    assert_eq!((c.turno.estado.as_str(), c.turno.diferencia, c.turno.total_esperado_efectivo), ("cerrado", Some(-1_000), Some(53_000)));

    // La cola: abrir, 3 ventas, egreso y cierre; todo lo demás depende de la apertura.
    let ops = cola(&conn);
    assert_eq!(ops.iter().map(|o| o.0.as_str()).collect::<Vec<_>>(), ["turno_abrir", "venta", "venta", "venta", "egreso", "turno_cerrar"]);
    for (_, deps, _) in &ops[1..] {
        assert_eq!(deps, &json!([t.turno.id]).to_string());
    }
    let cierre: Value = serde_json::from_str(&ops[5].2).unwrap();
    assert_eq!((cierre["efectivo_contado"].as_i64(), cierre["total_esperado_efectivo"].as_i64()), (Some(52_000), Some(53_000)));
    let mixta: Value = serde_json::from_str(&ops[2].2).unwrap();
    assert_eq!(mixta["pagos"].as_array().unwrap().len(), 2);
    assert_eq!(mixta["items"][0]["precio_lista"], 15_000);

    // Un turno cerrado no se toca, y ya no se puede cobrar en él.
    assert!(conn.execute("UPDATE caja_turnos SET efectivo_contado = 1", []).is_err());
    assert_eq!(codigo(registrar_egreso(&conn, ahora(), &yo, 1_000, "Hielo")), "NO_HAY_TURNO_ABIERTO");
}

#[test]
fn el_pase_de_dia_vendido_en_la_estacion_deja_entrar_de_inmediato_sin_red() {
    let (_d, conn) = base(true, false);
    let yo = recepcion();
    let antes = registrar_ingreso(&conn, ahora(), &yo, Objetivo::Documento("1001"), "manual").unwrap();
    assert!(!antes.abre, "sin membresía ni pase, no entra");

    abrir_turno(&conn, ahora(), &yo, 0, Confirmacion::SinRed).unwrap();
    let mut v = en("Efectivo", vec![pase("pase_dia", None)]);
    v.deportista_id = Some("d1".into());
    registrar_venta(&conn, ahora() + Duration::minutes(1), &yo, &v).unwrap();
    let despues = registrar_ingreso(&conn, ahora() + Duration::minutes(2), &yo, Objetivo::Documento("1001"), "manual").unwrap();
    assert!(despues.abre);
    assert!(despues.cliente.unwrap().con_pase_dia);

    let sin_cliente = registrar_venta(&conn, ahora(), &yo, &en("Efectivo", vec![pase("pase_dia", None)]));
    assert_eq!(codigo(sin_cliente), "PASE_DIA_REQUIERE_CLIENTE");
}

#[test]
fn sin_red_se_abre_igual_y_queda_marcado_sin_confirmar() {
    let (_d, conn) = base(true, false);
    let t = abrir_turno(&conn, ahora(), &recepcion(), 20_000, Confirmacion::SinRed).unwrap();
    assert!(t.turno.sin_confirmar);
    let payload: Value = serde_json::from_str(&cola(&conn)[0].2).unwrap();
    assert_eq!(payload["sin_confirmar"], true);
    assert_eq!(codigo(abrir_turno(&conn, ahora(), &jefe(), 0, Confirmacion::Confirmada)), "TURNO_YA_ABIERTO");
}

#[test]
fn permisos_y_descuentos_siguen_la_regla_descargada() {
    let (_d, conn) = base(false, false);
    assert_eq!(codigo(abrir_turno(&conn, ahora(), &recepcion(), 0, Confirmacion::Confirmada)), "PERMISO_DENEGADO");

    let (_d, conn) = base(true, false);
    let yo = recepcion();
    abrir_turno(&conn, ahora(), &yo, 0, Confirmacion::Confirmada).unwrap();
    let mut item = producto("proteina", 1);
    item.precio_cobrado = Some(9_000);
    item.motivo_descuento = Some("Cliente frecuente".into());
    assert_eq!(codigo(registrar_venta(&conn, ahora(), &yo, &en("Efectivo", vec![item.clone()]))), "SIN_PERMISO_DESCUENTO");

    // El Jefe sí puede: 10 % entra en el tope de 20 %, 25 % no, y sin motivo tampoco.
    let j = jefe();
    let r = registrar_venta(&conn, ahora(), &j, &en("Efectivo", vec![item.clone()])).unwrap();
    assert_eq!((r.total, r.items[0].motivo_descuento.as_deref()), (9_000, Some("Cliente frecuente")));
    item.precio_cobrado = Some(7_500);
    assert_eq!(codigo(registrar_venta(&conn, ahora(), &j, &en("Efectivo", vec![item.clone()]))), "DESCUENTO_SUPERA_TOPE");
    item.precio_cobrado = Some(8_000);
    item.motivo_descuento = Some("  ".into());
    assert_eq!(codigo(registrar_venta(&conn, ahora(), &j, &en("Efectivo", vec![item]))), "MOTIVO_DESCUENTO_REQUERIDO");
    // Justo en el tope (20,00 %) se permite.
    let mut tope = producto("agua", 1);
    tope.precio_cobrado = Some(2_400);
    tope.motivo_descuento = Some("Promoción".into());
    assert_eq!(registrar_venta(&conn, ahora(), &j, &en("Efectivo", vec![tope])).unwrap().total, 2_400);
}

#[test]
fn validaciones_de_la_venta() {
    let (_d, conn) = base(true, false);
    let yo = recepcion();
    assert_eq!(codigo(registrar_venta(&conn, ahora(), &yo, &en("Efectivo", vec![producto("agua", 1)]))), "NO_HAY_TURNO_ABIERTO");
    abrir_turno(&conn, ahora(), &yo, 0, Confirmacion::Confirmada).unwrap();
    assert_eq!(codigo(registrar_venta(&conn, ahora(), &yo, &en("Efectivo", vec![]))), "VENTA_VACIA");
    assert_eq!(codigo(registrar_venta(&conn, ahora(), &yo, &en("Efectivo", vec![producto("viejo", 1)]))), "PRODUCTO_INACTIVO");
    assert_eq!(codigo(registrar_venta(&conn, ahora(), &yo, &en("Efectivo", vec![pase("pase_clase", None)]))), "PRECIO_REQUERIDO");
    let mut v = en("Efectivo", vec![producto("agua", 1)]);
    v.valor_recibido = Some(1_000);
    assert_eq!(codigo(registrar_venta(&conn, ahora(), &yo, &v)), "PAGO_INSUFICIENTE");
    let mut v = en("Efectivo", vec![producto("agua", 1)]);
    v.pagos = Some(vec![NuevoMedio { metodo: "Efectivo".into(), monto: 1_000 }, NuevoMedio { metodo: "Nequi".into(), monto: 1_000 }]);
    assert_eq!(codigo(registrar_venta(&conn, ahora(), &yo, &v)), "MEDIOS_NO_SUMAN_TOTAL");
    assert_eq!(codigo(registrar_egreso(&conn, ahora(), &yo, 1_000, "ab")), "MOTIVO_REQUERIDO");
    // Un error no deja nada a medias.
    assert_eq!(cola(&conn).len(), 1);
}

#[test]
fn el_stock_disponible_descuenta_lo_vendido_que_no_ha_subido_y_no_se_cuenta_dos_veces() {
    let (_d, conn) = base(true, false);
    let yo = recepcion();
    abrir_turno(&conn, ahora(), &yo, 0, Confirmacion::Confirmada).unwrap();
    let disponible = |conn: &Connection| productos_para_venta(conn, "agua").unwrap()[0].disponible;
    let v = registrar_venta(&conn, ahora(), &yo, &en("Efectivo", vec![producto("agua", 3)])).unwrap();
    assert_eq!(disponible(&conn), 2);
    assert_eq!(codigo(registrar_venta(&conn, ahora(), &yo, &en("Efectivo", vec![producto("agua", 3)]))), "STOCK_INSUFICIENTE");

    // Una descarga trae el stock del servidor, que aún no tiene esta venta: sigue en 2.
    let p = json!({ "productos": [{ "id": "agua", "nombre": "Agua 600 ml", "precio": 3000, "stock": 5, "activo": true }] });
    aplicar_pagina(&conn, ahora(), &pagina("c2", false, p)).unwrap();
    assert_eq!(disponible(&conn), 2);

    // El servidor la aplica: el stock local baja y la venta deja de restar. Sigue en 2.
    let lote: Vec<OperacionEnviada> = outbox::tomar_lote(&conn, 50).unwrap();
    let venta_en_lote = lote.iter().find(|o| o.id == v.id).unwrap().clone();
    let respuesta = json!({ "resultados": lote.iter().map(|o| json!({ "id": o.id, "resultado": "aplicada" })).collect::<Vec<_>>() });
    outbox::aplicar_resultados(&conn, ahora(), &lote, &respuesta).unwrap();
    assert_eq!(disponible(&conn), 2);
    // Una respuesta repetida no descuenta otra vez.
    outbox::aplicar_resultados(&conn, ahora(), &[venta_en_lote], &respuesta).unwrap();
    assert_eq!(disponible(&conn), 2);
    // Y la siguiente descarga, que ya la incluye, deja todo igual.
    let p = json!({ "productos": [{ "id": "agua", "nombre": "Agua 600 ml", "precio": 3000, "stock": 2, "activo": true }] });
    aplicar_pagina(&conn, ahora(), &pagina("c3", false, p)).unwrap();
    assert_eq!(disponible(&conn), 2);
}

#[test]
fn el_cierre_diario_suma_los_turnos_del_dia_de_bogota() {
    let (_d, conn) = base(true, false);
    let yo = recepcion();
    // Turno de la mañana
    abrir_turno(&conn, ahora(), &yo, 30_000, Confirmacion::Confirmada).unwrap();
    registrar_venta(&conn, ahora(), &yo, &en("Efectivo", vec![producto("agua", 1)])).unwrap();
    cerrar_turno(&conn, ahora() + Duration::hours(4), &yo, 33_000, None).unwrap();
    // Turno de la tarde, sigue abierto
    abrir_turno(&conn, ahora() + Duration::hours(5), &yo, 10_000, Confirmacion::SinRed).unwrap();
    registrar_venta(&conn, ahora() + Duration::hours(5), &yo, &en("Nequi", vec![producto("proteina", 1)])).unwrap();
    registrar_egreso(&conn, ahora() + Duration::hours(6), &yo, 2_000, "Papel higiénico").unwrap();
    // A las 23:30 de Bogotá todavía es el 12; a las 00:30 ya es el 13.
    let c = cierre_diario(&conn, "2026-11-12".parse().unwrap()).unwrap();
    assert_eq!(c.turnos.len(), 2);
    assert_eq!((c.totales.base_inicial, c.totales.ventas_efectivo, c.totales.ventas_otro, c.totales.egresos_efectivo), (40_000, 3_000, 10_000, 2_000));
    assert_eq!(c.totales.total_esperado_efectivo, 41_000);
    assert_eq!((c.efectivo_contado, c.diferencia, c.turnos_abiertos), (33_000, 0, 1));
    assert_eq!(c.sin_subir, 3);
    assert!(cierre_diario(&conn, "2026-11-13".parse().unwrap()).unwrap().turnos.is_empty());
}

#[test]
fn el_porcentaje_de_descuento_redondea_igual_que_el_servidor() {
    // round((lista − cobrado) / lista × 100, 2)
    assert_eq!(super::descuento_centesimas(3000, 2000), 3333);
    assert_eq!(super::descuento_centesimas(3000, 1000), 6667);
    assert_eq!(super::descuento_centesimas(10000, 8000), 2000);
    assert_eq!(super::descuento_centesimas(10000, 10000), 0);
    assert_eq!(super::descuento_centesimas(0, 0), 0);
}
