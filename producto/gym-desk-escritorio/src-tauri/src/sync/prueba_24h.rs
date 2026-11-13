//! Criterio de terminado de la fase 1: 24 horas sin red, se reconecta y no hay duplicados ni pérdidas.
//!
//! Es una prueba **acelerada**: las 24 horas las da un reloj simulado, no se esperan de verdad.
//! Todo lo demás es real: base SQLCipher en disco, HTTP contra la API del gimnasio y su PostgreSQL.
//! El "sin red" se hace cortando el transporte de la estación; el servidor sigue arriba.
//!
//! No corre con `cargo test` a secas porque necesita la API levantada. La ejecuta
//! `pruebas/prueba_24h.py`, que prepara el gimnasio, levanta la API, corre esto y después compara
//! los conteos de la estación con los del servidor.

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use chrono::Duration;
use rusqlite::Connection;
use serde_json::{json, Value};

use crate::db;
use crate::db::clave::pruebas::ProtectorDePrueba;
use crate::reloj::pruebas::RelojFijo;
use crate::reloj::Reloj;
use crate::sesion::{Credencial, GestorSesion};
use crate::sync::activacion::activar;
use crate::sync::descarga::ResultadoDescarga;
use crate::sync::ingreso::iniciar_con_password;
use crate::sync::motor::{ciclo, enviar_pendientes, Espera};
use crate::sync::outbox::{self, conteos};
use crate::sync::transporte::{ErrorTransporte, Metodo, Peticion, Transporte, TransporteHttp};

/// Transporte real con un interruptor: permite "desconectar el cable" de la estación.
struct TransporteConCorte {
    real: TransporteHttp,
    sin_red: AtomicBool,
    /// La próxima petición llega al servidor pero la respuesta se pierde en el camino.
    perder_respuesta: AtomicBool,
    operaciones_enviadas: AtomicUsize,
    envios: AtomicUsize,
}

impl Transporte for TransporteConCorte {
    fn enviar(&self, base: &str, p: Peticion<'_>) -> Result<Value, ErrorTransporte> {
        if self.sin_red.load(Ordering::SeqCst) {
            return Err(ErrorTransporte::SinConexion("sin red (corte simulado)".into()));
        }
        if p.ruta == "/sync/push" {
            self.envios.fetch_add(1, Ordering::SeqCst);
            let n = p.cuerpo.and_then(|c| c["operaciones"].as_array()).map_or(0, |a| a.len());
            self.operaciones_enviadas.fetch_add(n, Ordering::SeqCst);
        }
        let respuesta = self.real.enviar(base, p);
        if self.perder_respuesta.swap(false, Ordering::SeqCst) {
            return Err(ErrorTransporte::SinConexion("respuesta perdida (corte simulado)".into()));
        }
        respuesta
    }
}

fn entorno(nombre: &str) -> String {
    std::env::var(nombre).unwrap_or_else(|_| panic!("falta la variable {nombre}: esta prueba la ejecuta pruebas/prueba_24h.py"))
}

fn abrir(dir: &std::path::Path, reloj: &RelojFijo) -> Mutex<Connection> {
    let conn = db::preparar(dir, &ProtectorDePrueba, reloj.ahora()).expect("abrir la base de la estación");
    // Lo mismo que hace la app al arrancar.
    outbox::recuperar_enviando(&conn).unwrap();
    Mutex::new(conn)
}

fn en_cola(base: &Mutex<Connection>) -> i64 {
    base.lock().unwrap().query_row("SELECT count(*) FROM sync_outbox", [], |f| f.get(0)).unwrap()
}

#[test]
#[ignore = "necesita la API real; la ejecuta pruebas/prueba_24h.py"]
fn veinticuatro_horas_sin_red_y_al_reconectar_no_hay_duplicados_ni_perdidas() {
    let subdominio = entorno("GYMDESK_PRUEBA_SUBDOMINIO");
    let codigo = entorno("GYMDESK_PRUEBA_CODIGO");
    let correo = entorno("GYMDESK_PRUEBA_CORREO");
    let password = entorno("GYMDESK_PRUEBA_PASSWORD");
    let salida = entorno("GYMDESK_PRUEBA_SALIDA");
    assert!(std::env::var("GYMDESK_API_URL").is_ok(), "falta GYMDESK_API_URL con la dirección de la API de pruebas");

    let dir = tempfile::tempdir().unwrap();
    let reloj = RelojFijo::en("2026-11-12T11:00:00Z"); // 6:00 a. m. en Bogotá
    let t = TransporteConCorte {
        real: TransporteHttp::nuevo(),
        sin_red: AtomicBool::new(false),
        perder_respuesta: AtomicBool::new(false),
        operaciones_enviadas: AtomicUsize::new(0),
        envios: AtomicUsize::new(0),
    };
    let mut base = abrir(dir.path(), &reloj);
    let mut sesion = Mutex::new(GestorSesion::default());

    // ---- Con red: activar, descargar y primer ingreso -------------------------------------
    activar(&base, &t, &reloj, &subdominio, &codigo).expect("activar la estación");
    let primero = ciclo(&base, &t, &reloj).expect("primera sincronización");
    assert!(matches!(primero.descarga, ResultadoDescarga::Completa { .. }));
    iniciar_con_password(&base, &sesion, &t, &reloj, &correo, &password).expect("primer ingreso, validado en el servidor");
    sesion.lock().unwrap().definir_pin(&base.lock().unwrap(), reloj.ahora(), &password, "4821").unwrap();
    ciclo(&base, &t, &reloj).expect("subir lo hecho con red");
    assert_eq!(conteos(&base.lock().unwrap()).unwrap().por_enviar, 0);
    let subidas_con_red = t.operaciones_enviadas.load(Ordering::SeqCst);

    // ---- Se cae la red: 24 horas de trabajo normal ------------------------------------------
    t.sin_red.store(true, Ordering::SeqCst);
    let mut espera = Espera::default();
    let mut esperas_maximas = 0;
    for paso in 0..144 {
        // Cada 10 minutos: la pantalla se bloqueó por inactividad y alguien la desbloquea con su PIN.
        reloj.avanzar(Duration::minutes(10));
        {
            let conn = base.lock().unwrap();
            let mut gestor = sesion.lock().unwrap();
            assert_eq!(gestor.estado(&conn, reloj.ahora()).unwrap().estado, "bloqueada");
            if paso % 9 == 4 {
                // De vez en cuando se equivocan de PIN.
                assert!(gestor.desbloquear(&conn, reloj.ahora(), Credencial::Pin("0000")).is_err());
            }
            gestor.desbloquear(&conn, reloj.ahora(), Credencial::Pin("4821")).expect("desbloquear sin red");
            if paso % 12 == 11 {
                // Cambio de turno: cierra sesión y entra otra vez con PIN, todo sin red.
                let id = gestor.estado(&conn, reloj.ahora()).unwrap().usuario.unwrap().id;
                gestor.cerrar(&conn, reloj.ahora()).unwrap();
                gestor.iniciar_con_pin(&conn, reloj.ahora(), &id, "4821").expect("entrar con PIN sin red");
            }
        }
        // La estación sigue intentando sincronizar y no puede; no pierde nada por intentarlo.
        let antes = en_cola(&base);
        assert!(ciclo(&base, &t, &reloj).unwrap_err().es_sin_conexion());
        assert_eq!(en_cola(&base), antes);
        if espera.siguiente(false).as_secs() == 300 {
            esperas_maximas += 1;
        }
    }
    assert!(esperas_maximas > 100, "sin red, la espera entre intentos debe llegar al máximo de 5 minutos");

    let pendientes = conteos(&base.lock().unwrap()).unwrap().por_enviar;
    assert!(pendientes > 300, "24 h de trabajo deben dejar cientos de operaciones en cola, hay {pendientes}");
    assert_eq!(t.operaciones_enviadas.load(Ordering::SeqCst), subidas_con_red, "sin red no salió nada");

    // ---- Vuelve la red, y pasa lo peor -----------------------------------------------------
    t.sin_red.store(false, Ordering::SeqCst);

    // 1) El primer lote llega al servidor pero la respuesta se pierde.
    t.perder_respuesta.store(true, Ordering::SeqCst);
    assert!(enviar_pendientes(&base, &t, &reloj).is_err());
    assert_eq!(conteos(&base.lock().unwrap()).unwrap().por_enviar, pendientes, "la estación no sabe que llegaron");

    // 2) La app se cierra a mitad de envío: el lote salió, el servidor lo recibió y la app murió
    //    antes de guardar la respuesta.
    {
        let (cred, lote) = {
            let conn = base.lock().unwrap();
            (crate::sync::descarga::credenciales(&conn).unwrap().unwrap(), outbox::tomar_lote(&conn, outbox::TAMANO_LOTE).unwrap())
        };
        let cuerpo = json!({ "operaciones": lote.iter().map(|o| o.cuerpo.clone()).collect::<Vec<_>>() });
        t.enviar(&cred.api_base, Peticion { metodo: Metodo::Post, ruta: "/sync/push", token: Some(&cred.token), consulta: vec![], cuerpo: Some(&cuerpo) })
            .expect("el servidor recibe el lote");
        let enviando: i64 = base.lock().unwrap().query_row("SELECT count(*) FROM sync_outbox WHERE estado = 'enviando'", [], |f| f.get(0)).unwrap();
        assert_eq!(enviando as usize, lote.len());
    }
    drop(base);
    drop(sesion);

    // 3) Se vuelve a abrir la app sobre la misma base en disco.
    base = abrir(dir.path(), &reloj);
    sesion = Mutex::new(GestorSesion::default());
    assert_eq!(conteos(&base.lock().unwrap()).unwrap().por_enviar, pendientes, "al reabrir, todo sigue en cola");

    // ---- Reconexión ------------------------------------------------------------------------
    let resultado = ciclo(&base, &t, &reloj).expect("sincronizar tras 24 h");
    assert!(matches!(resultado.descarga, ResultadoDescarga::Completa { .. }));

    let c = conteos(&base.lock().unwrap()).unwrap();
    assert_eq!((c.por_enviar, c.con_error, c.por_revisar), (0, 0, 0), "todo quedó subido y sin errores");

    // Sincronizar otra vez no reenvía nada.
    let enviadas = t.operaciones_enviadas.load(Ordering::SeqCst);
    ciclo(&base, &t, &reloj).unwrap();
    ciclo(&base, &t, &reloj).unwrap();
    assert_eq!(t.operaciones_enviadas.load(Ordering::SeqCst), enviadas);

    // Después de todo, la persona entra con su PIN como si nada.
    {
        let conn = base.lock().unwrap();
        let id: String = conn.query_row("SELECT id FROM staff_local WHERE hash_pin IS NOT NULL", [], |f| f.get(0)).unwrap();
        sesion.lock().unwrap().iniciar_con_pin(&conn, reloj.ahora(), &id, "4821").expect("entrar con PIN tras reabrir");
    }
    ciclo(&base, &t, &reloj).unwrap();

    // ---- Lo que la estación dice haber hecho, para compararlo con el servidor ---------------
    let conn = base.lock().unwrap();
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM sync_outbox ORDER BY secuencia").unwrap();
        let filas = stmt.query_map([], |f| f.get(0)).unwrap();
        filas.map(|f| f.unwrap()).collect()
    };
    let (aplicadas, auditoria_integra): (i64, bool) = (
        conn.query_row("SELECT count(*) FROM sync_outbox WHERE estado = 'aplicada'", [], |f| f.get(0)).unwrap(),
        crate::auditoria::primera_fila_alterada(&conn).unwrap().is_none(),
    );
    assert_eq!(aplicadas as usize, ids.len());
    assert!(auditoria_integra);
    let estacion: String = conn.query_row("SELECT estacion_servidor_id FROM estacion", [], |f| f.get(0)).unwrap();
    let informe = json!({
        "estacion_servidor_id": estacion,
        "operaciones": ids.len(),
        "ids": ids,
        "en_cola_al_reconectar": pendientes,
        "horas_simuladas": 24,
        "envios_http": t.envios.load(Ordering::SeqCst),
        "operaciones_transmitidas": t.operaciones_enviadas.load(Ordering::SeqCst),
    });
    std::fs::write(&salida, serde_json::to_string_pretty(&informe).unwrap()).unwrap();
}
