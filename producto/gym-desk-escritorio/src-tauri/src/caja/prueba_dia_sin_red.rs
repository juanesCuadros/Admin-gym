//! Criterio de terminado de la fase 3A: un día de caja sin red y, al reconectar, el turno del servidor es
//! igual al de la estación peso por peso y por medio de pago, sin duplicados, y el stock coincide. Dos
//! conflictos provocados (turno simultáneo y stock negativo) terminan por revisar sin perder nada.
//!
//! Base SQLCipher en disco, HTTP contra la API del gimnasio y su PostgreSQL. El "sin red" se hace
//! cortando el transporte de la estación; el servidor sigue arriba y la web sigue trabajando.
//! El día se simula con un reloj que empieza 12 horas atrás y llega a la hora real al reconectar: así
//! el reloj de la estación coincide con el del servidor y nada queda por revisar por desfase.
//!
//! No corre con `cargo test` a secas: la ejecuta `pruebas/prueba_caja.py`, que prepara el gimnasio,
//! levanta la API, corre esto y compara con lo que quedó en el servidor.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use chrono::{Duration, Utc};
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::acceso::registro::{registrar_ingreso, Objetivo};
use crate::caja::*;
use crate::db;
use crate::db::clave::pruebas::ProtectorDePrueba;
use crate::reloj::pruebas::RelojFijo;
use crate::reloj::{a_texto, Reloj};
use crate::sesion::UsuarioSesion;
use crate::sync::activacion::activar;
use crate::sync::descarga::{credenciales, ResultadoDescarga};
use crate::sync::motor::{ciclo, enviar_pendientes};
use crate::sync::outbox::conteos;
use crate::sync::transporte::{ErrorTransporte, Peticion, Transporte, TransporteHttp};

struct TransporteConCorte {
    real: TransporteHttp,
    sin_red: AtomicBool,
    perder_respuesta: AtomicBool,
}

impl Transporte for TransporteConCorte {
    fn enviar(&self, base: &str, p: Peticion<'_>) -> Result<Value, ErrorTransporte> {
        if self.sin_red.load(Ordering::SeqCst) {
            return Err(ErrorTransporte::SinConexion("sin red (corte simulado)".into()));
        }
        let respuesta = self.real.enviar(base, p);
        if self.perder_respuesta.swap(false, Ordering::SeqCst) {
            return Err(ErrorTransporte::SinConexion("respuesta perdida (corte simulado)".into()));
        }
        respuesta
    }
}

fn entorno(nombre: &str) -> String {
    std::env::var(nombre).unwrap_or_else(|_| panic!("falta la variable {nombre}: esta prueba la ejecuta pruebas/prueba_caja.py"))
}

/// Lo que hace la web mientras la estación está sin red (con la sesión del Jefe).
fn web(metodo: &str, ruta: &str, cuerpo: Value) -> Value {
    let url = format!("{}{}", entorno("GYMDESK_API_URL"), ruta);
    let r = ureq::request(metodo, &url)
        .set("Authorization", &format!("Bearer {}", entorno("GYMDESK_PRUEBA_TOKEN_JEFE")))
        .set("X-Idempotency-Key", &uuid::Uuid::new_v4().to_string())
        .send_json(cuerpo);
    match r {
        Ok(r) => r.into_json().unwrap(),
        Err(ureq::Error::Status(c, r)) => panic!("la web respondió {c}: {}", r.into_string().unwrap_or_default()),
        Err(e) => panic!("la web no respondió: {e}"),
    }
}

fn uno(conn: &Connection, consulta: &str) -> i64 {
    conn.query_row(consulta, [], |f| f.get(0)).unwrap()
}

#[test]
#[ignore = "necesita la API real; la ejecuta pruebas/prueba_caja.py"]
fn un_dia_de_caja_sin_red_queda_igual_en_el_servidor() {
    let subdominio = entorno("GYMDESK_PRUEBA_SUBDOMINIO");
    let codigo = entorno("GYMDESK_PRUEBA_CODIGO");
    let correo = entorno("GYMDESK_PRUEBA_CORREO");
    let cliente_id = entorno("GYMDESK_PRUEBA_CLIENTE");
    let documento = entorno("GYMDESK_PRUEBA_DOCUMENTO");
    let agua = entorno("GYMDESK_PRUEBA_AGUA");
    let barra = entorno("GYMDESK_PRUEBA_BARRA");
    let salida = entorno("GYMDESK_PRUEBA_SALIDA");
    let socio = entorno("GYMDESK_PRUEBA_SOCIO");
    let socio_nuevo = entorno("GYMDESK_PRUEBA_SOCIO_NUEVO");
    let doc_nuevo = entorno("GYMDESK_PRUEBA_DOC_NUEVO");

    let dir = tempfile::tempdir().unwrap();
    let inicio = Utc::now() - Duration::hours(12);
    let reloj = RelojFijo::en(&a_texto(inicio));
    let t = TransporteConCorte { real: TransporteHttp::nuevo(), sin_red: AtomicBool::new(false), perder_respuesta: AtomicBool::new(false) };
    let base = Mutex::new(db::preparar(dir.path(), &ProtectorDePrueba, reloj.ahora()).unwrap());

    // ---- Con red: activar y descargar ---------------------------------------------------------
    activar(&base, &t, &reloj, &subdominio, &codigo).expect("activar la estación");
    assert!(matches!(ciclo(&base, &t, &reloj).expect("descarga inicial").descarga, ResultadoDescarga::Completa { .. }));
    let yo: UsuarioSesion = base
        .lock()
        .unwrap()
        .query_row("SELECT id, nombre, correo, rol FROM staff_local WHERE correo = ?1", [correo.to_lowercase()], |f| {
            Ok(UsuarioSesion { id: f.get(0)?, nombre: f.get(1)?, correo: f.get(2)?, rol: f.get(3)?, tiene_pin: false })
        })
        .unwrap();

    // ---- A1 con red: la web tiene la caja abierta y la estación no puede abrir --------------------
    let turno_web = web("POST", "/caja/turnos/abrir", json!({ "base_inicial": 10000 }));
    let cred = credenciales(&base.lock().unwrap()).unwrap();
    let rechazo = confirmar_turno_unico(&t, cred.as_ref()).unwrap_err();
    assert_eq!(rechazo.codigo, "TURNO_AJENO_ABIERTO");
    assert!(rechazo.mensaje.contains("la web"), "{}", rechazo.mensaje);

    // ---- Se cae la red. La estación abre sin poder confirmar ------------------------------------
    t.sin_red.store(true, Ordering::SeqCst);
    let confirmacion = confirmar_turno_unico(&t, cred.as_ref()).unwrap();
    assert_eq!(confirmacion, Confirmacion::SinRed);
    let turno = {
        let conn = base.lock().unwrap();
        abrir_turno(&conn, reloj.ahora(), &yo, 50_000, confirmacion).unwrap().turno
    };
    assert!(turno.sin_confirmar);

    // Mientras tanto, la web vende las 2 barras que quedaban (en la estación todavía figuran 2).
    web("POST", "/caja/ventas", json!({
        "metodo": "Efectivo", "tipo_medio": "efectivo",
        "items": [{ "tipo": "producto", "producto_id": barra, "descripcion": "Barra", "cantidad": 2 }]
    }));

    // ---- Un día de mostrador sin red -----------------------------------------------------------
    let medios = ["Efectivo", "Nequi", "Datáfono"];
    let mut ventas = 0;
    {
        let conn = base.lock().unwrap();
        let vender = |items: Vec<NuevoItem>, metodo: &str, recibido: Option<i64>, cliente: Option<&str>, pagos: Option<Vec<NuevoMedio>>| {
            let v = NuevaVenta {
                deportista_id: cliente.map(str::to_string),
                items,
                metodo: if pagos.is_some() { None } else { Some(metodo.into()) },
                pagos,
                valor_recibido: recibido,
                nota: None,
            };
            registrar_venta(&conn, reloj.ahora(), &yo, &v).expect("vender sin red")
        };
        let producto = |id: &str, n: i64| NuevoItem {
            tipo: "producto".into(), producto_id: Some(id.into()), cantidad: n, precio: None, precio_cobrado: None, motivo_descuento: None,
        };
        let pase = |tipo: &str, precio: Option<i64>| NuevoItem {
            tipo: tipo.into(), producto_id: None, cantidad: 1, precio, precio_cobrado: None, motivo_descuento: None,
        };

        // Pase de día con pago mixto: el cliente entra de inmediato, sin red.
        reloj.avanzar(Duration::minutes(20));
        vender(
            vec![pase("pase_dia", None)],
            "",
            Some(10_000),
            Some(&cliente_id),
            Some(vec![NuevoMedio { metodo: "Efectivo".into(), monto: 5_000 }, NuevoMedio { metodo: "Nequi".into(), monto: 10_000 }]),
        );
        ventas += 1;
        reloj.avanzar(Duration::minutes(1));
        let entra = registrar_ingreso(&conn, reloj.ahora(), &yo, Objetivo::Documento(&documento), "manual").unwrap();
        assert!(entra.abre, "el pase de día vendido en la estación deja entrar de inmediato");

        // Fase 3B: renovar a un socio (al precio al que compró) y venderle un plan a otro, que entra de una vez.
        use crate::caja::membresias::{cobrar, NuevoCobroMembresia};
        reloj.avanzar(Duration::minutes(5));
        let renovacion = cobrar(&conn, reloj.ahora(), &yo, &NuevoCobroMembresia {
            deportista_id: socio.clone(), accion: "renovar".into(), plan_id: None, precio_cobrado: None, motivo_descuento: None,
            metodo: Some("Efectivo".into()), pagos: None, valor_recibido: Some(100_000), nota: None,
        })
        .expect("renovar sin red");
        assert_eq!((renovacion.precio_cobrado, renovacion.cambio), (70_000, Some(30_000)));
        reloj.avanzar(Duration::minutes(5));
        let plan = crate::caja::membresias::opciones(&conn, &socio_nuevo, crate::reloj::fecha_negocio(reloj.ahora())).unwrap().planes[0].id.clone();
        cobrar(&conn, reloj.ahora(), &yo, &NuevoCobroMembresia {
            deportista_id: socio_nuevo.clone(), accion: "vender".into(), plan_id: Some(plan), precio_cobrado: None, motivo_descuento: None,
            metodo: None, pagos: Some(vec![NuevoMedio { metodo: "Efectivo".into(), monto: 30_000 }, NuevoMedio { metodo: "Nequi".into(), monto: 50_000 }]),
            valor_recibido: Some(30_000), nota: Some("paga el resto con Nequi".into()),
        })
        .expect("vender plan sin red");
        reloj.avanzar(Duration::minutes(1));
        let entra = registrar_ingreso(&conn, reloj.ahora(), &yo, Objetivo::Documento(&doc_nuevo), "manual").unwrap();
        assert!(entra.abre, "el plan vendido en la estación deja entrar de inmediato");

        // La barra que en el servidor ya no hay.
        vender(vec![producto(&barra, 1)], "Efectivo", Some(5_000), None, None);
        ventas += 1;

        for i in 0..40 {
            reloj.avanzar(Duration::minutes(15));
            let metodo = medios[i % 3];
            match i % 5 {
                0 => vender(vec![producto(&agua, 2)], metodo, if metodo == "Efectivo" { Some(10_000) } else { None }, None, None),
                1 => vender(vec![pase("pase_clase", Some(12_000))], metodo, None, None, None),
                2 => vender(
                    vec![producto(&agua, 1), pase("pase_clase", Some(12_000))],
                    "",
                    Some(20_000),
                    None,
                    Some(vec![NuevoMedio { metodo: "Efectivo".into(), monto: 7_000 }, NuevoMedio { metodo: metodo.into(), monto: 8_000 }]),
                ),
                _ => vender(vec![producto(&agua, 1)], metodo, None, None, None),
            };
            ventas += 1;
            if i % 13 == 6 {
                registrar_egreso(&conn, reloj.ahora(), &yo, 4_000 + i as i64 * 100, "Compra de insumos de aseo").unwrap();
            }
        }
    }

    // La estación sigue intentando sincronizar y no puede; no pierde nada.
    let en_cola = uno(&base.lock().unwrap(), "SELECT count(*) FROM sync_outbox");
    assert!(ciclo(&base, &t, &reloj).unwrap_err().es_sin_conexion());
    assert_eq!(uno(&base.lock().unwrap(), "SELECT count(*) FROM sync_outbox"), en_cola);

    // Cierre del turno con el arqueo exacto.
    let cierre = {
        let conn = base.lock().unwrap();
        let esperado = totales(&conn, &turno.id).unwrap().total_esperado_efectivo;
        cerrar_turno(&conn, reloj.ahora(), &yo, esperado, Some("Cierre del día sin red")).unwrap()
    };
    assert_eq!(cierre.turno.diferencia, Some(0));

    // La web cierra el suyo con su propio arqueo: 10.000 de base + 2 barras.
    let precio_barra: i64 = uno(&base.lock().unwrap(), &format!("SELECT precio FROM productos WHERE id = '{barra}'"));
    let cierre_web = web("POST", "/caja/turnos/cerrar", json!({ "efectivo_contado": 10_000 + 2 * precio_barra }));
    // La API manda los decimales como texto.
    let diferencia_web = cierre_web["diferencia"].as_str().and_then(|s| s.parse::<f64>().ok()).or(cierre_web["diferencia"].as_f64());
    assert_eq!(diferencia_web, Some(0.0));

    // ---- Vuelve la red: el reloj de la estación llega a la hora real -------------------------------
    reloj.avanzar(Utc::now() - reloj.ahora());
    t.sin_red.store(false, Ordering::SeqCst);
    let pendientes = conteos(&base.lock().unwrap()).unwrap().por_enviar;
    // El primer lote llega al servidor pero la respuesta se pierde.
    t.perder_respuesta.store(true, Ordering::SeqCst);
    assert!(enviar_pendientes(&base, &t, &reloj).is_err());
    assert_eq!(conteos(&base.lock().unwrap()).unwrap().por_enviar, pendientes);
    // Reconexión.
    let r = ciclo(&base, &t, &reloj).expect("sincronizar al reconectar");
    assert!(matches!(r.descarga, ResultadoDescarga::Completa { .. }));
    ciclo(&base, &t, &reloj).unwrap();

    let conn = base.lock().unwrap();
    let c = conteos(&conn).unwrap();
    assert_eq!((c.por_enviar, c.con_error), (0, 0), "todo subió y sin errores");
    let revisiones: Vec<(String, String)> = {
        let mut stmt = conn.prepare("SELECT tipo, ultimo_error_codigo FROM sync_outbox WHERE estado = 'pendiente_revision' ORDER BY secuencia").unwrap();
        let filas = stmt.query_map([], |f| Ok((f.get(0)?, f.get(1)?))).unwrap();
        filas.map(|f| f.unwrap()).collect()
    };
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM sync_outbox ORDER BY secuencia").unwrap();
        let filas = stmt.query_map([], |f| f.get(0)).unwrap();
        filas.map(|f| f.unwrap()).collect()
    };
    let final_ = resumen(&conn, &turno.id).unwrap();
    let stock: Value = {
        let mut stmt = conn.prepare("SELECT id, stock FROM productos").unwrap();
        let filas = stmt.query_map([], |f| Ok((f.get::<_, String>(0)?, f.get::<_, i64>(1)?))).unwrap();
        filas.map(|f| f.unwrap()).map(|(id, s)| (id, json!(s))).collect::<serde_json::Map<_, _>>().into()
    };
    let disponibles: Value = productos_para_venta(&conn, "")
        .unwrap()
        .into_iter()
        .map(|p| (p.id, json!(p.disponible)))
        .collect::<serde_json::Map<_, _>>()
        .into();
    let vencimientos: Value = {
        let mut stmt = conn.prepare("SELECT id, fecha_vencimiento FROM membresias WHERE deportista_id IN (?1, ?2)").unwrap();
        let filas = stmt.query_map([&socio, &socio_nuevo], |f| Ok((f.get::<_, String>(0)?, f.get::<_, String>(1)?))).unwrap();
        filas.map(|f| f.unwrap()).map(|(id, v)| (id, json!(v))).collect::<serde_json::Map<_, _>>().into()
    };
    let informe = json!({
        "turno_estacion": turno.id,
        "turno_web": turno_web["id"],
        "turno": final_.turno,
        "totales": final_.totales,
        "ventas": ventas,
        "egresos": uno(&conn, "SELECT count(*) FROM caja_egresos"),
        "ids": ids,
        "revisiones": revisiones,
        "stock": stock,
        "disponible": disponibles,
        "en_cola_al_reconectar": pendientes,
        "vencimientos": vencimientos,
        "auditoria_local_integra": crate::auditoria::primera_fila_alterada(&conn).unwrap().is_none(),
    });
    std::fs::write(&salida, serde_json::to_string_pretty(&informe).unwrap()).unwrap();
}
