//! Criterio de terminado de la fase 2: la estación decide el ingreso igual que el servidor.
//!
//! Todo es real: base SQLCipher en disco, HTTP contra la API del gimnasio y su PostgreSQL, y el
//! reloj del equipo. La estación se activa, descarga, evalúa a cada cliente con sus datos locales,
//! registra un ingreso por cada uno y los sube.
//!
//! No corre con `cargo test` a secas porque necesita la API levantada. La ejecuta
//! `pruebas/prueba_acceso.py`, que crea los clientes en cada situación, le pregunta lo mismo al
//! servidor y compara las dos respuestas campo por campo.

use std::sync::Mutex;

use serde_json::{json, Map, Value};

use crate::acceso::registro::{evaluar_cliente, registrar_ingreso, Objetivo};
use crate::db;
use crate::db::clave::pruebas::ProtectorDePrueba;
use crate::reloj::{fecha_negocio, Reloj, RelojSistema};
use crate::sesion::GestorSesion;
use crate::sync::activacion::activar;
use crate::sync::descarga::ResultadoDescarga;
use crate::sync::ingreso::iniciar_con_password;
use crate::sync::motor::ciclo;
use crate::sync::transporte::TransporteHttp;

fn entorno(nombre: &str) -> String {
    std::env::var(nombre).unwrap_or_else(|_| panic!("falta la variable {nombre}: esta prueba la ejecuta pruebas/prueba_acceso.py"))
}

#[test]
#[ignore = "necesita la API real; la ejecuta pruebas/prueba_acceso.py"]
fn la_estacion_decide_el_ingreso_igual_que_el_servidor() {
    let subdominio = entorno("GYMDESK_PRUEBA_SUBDOMINIO");
    let codigo = entorno("GYMDESK_PRUEBA_CODIGO");
    let correo = entorno("GYMDESK_PRUEBA_CORREO");
    let password = entorno("GYMDESK_PRUEBA_PASSWORD");
    let salida = entorno("GYMDESK_PRUEBA_SALIDA");
    assert!(std::env::var("GYMDESK_API_URL").is_ok(), "falta GYMDESK_API_URL con la dirección de la API de pruebas");

    let dir = tempfile::tempdir().unwrap();
    let reloj = RelojSistema;
    let t = TransporteHttp::nuevo();
    let base = Mutex::new(db::preparar(dir.path(), &ProtectorDePrueba, reloj.ahora()).expect("abrir la base de la estación"));
    let sesion = Mutex::new(GestorSesion::default());

    activar(&base, &t, &reloj, &subdominio, &codigo).expect("activar la estación");
    let primero = ciclo(&base, &t, &reloj).expect("descarga inicial");
    assert!(matches!(primero.descarga, ResultadoDescarga::Completa { .. }));
    iniciar_con_password(&base, &sesion, &t, &reloj, &correo, &password).expect("primer ingreso del personal");

    // ---- Evaluación local de cada cliente descargado ---------------------------------------
    let mut evaluados = Map::new();
    let mut registrados = Map::new();
    {
        let conn = base.lock().unwrap();
        let usuario = sesion.lock().unwrap().exigir_activa(&conn, reloj.ahora()).unwrap();
        let ids: Vec<String> = {
            let mut s = conn.prepare("SELECT id FROM deportistas ORDER BY id").unwrap();
            let filas = s.query_map([], |f| f.get(0)).unwrap();
            filas.collect::<Result<_, _>>().unwrap()
        };
        assert!(ids.len() >= 30, "la estación descargó muy pocos clientes: {}", ids.len());
        for id in ids {
            let ahora = reloj.ahora();
            // Un cliente eliminado no existe para la estación, igual que el servidor responde 404.
            let Some(c) = evaluar_cliente(&conn, &id, fecha_negocio(ahora)).unwrap() else { continue };
            evaluados.insert(
                id.clone(),
                json!({
                    "estado": c.estado, "dias_restantes_o_vencido": c.dias_restantes_o_vencido,
                    "resultado": c.resultado, "abre": c.abre, "mensaje": c.mensaje, "con_pase_dia": c.con_pase_dia,
                }),
            );
            // Y lo registra de verdad, como lo haría recepción.
            let r = registrar_ingreso(&conn, ahora, &usuario, Objetivo::Id(&id), "manual").unwrap();
            assert!(!r.relectura_ignorada);
            registrados.insert(r.id.unwrap(), json!({ "deportista_id": id, "resultado": r.resultado }));
        }
    }

    // ---- Sube lo registrado ----------------------------------------------------------------
    let envio = ciclo(&base, &t, &reloj).expect("subir los ingresos").envio;
    let conn = base.lock().unwrap();
    let sin_subir: i64 = conn
        .query_row("SELECT count(*) FROM sync_outbox WHERE tipo = 'ingreso' AND estado NOT IN ('aplicada', 'pendiente_revision')", [], |f| f.get(0))
        .unwrap();
    assert_eq!(sin_subir, 0, "quedaron ingresos sin subir");

    let informe: Value = json!({
        "evaluados": evaluados, "registrados": registrados,
        "por_revisar_segun_la_estacion": envio.por_revisar, "con_error": envio.con_error,
    });
    std::fs::write(&salida, serde_json::to_string_pretty(&informe).unwrap()).expect("escribir el informe");
}
