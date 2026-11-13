//! Pruebas de la cola de envío y del motor, contra una base SQLCipher real.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::auditoria::{self, Actor};
use crate::db::pruebas::reloj;
use crate::reloj::Reloj;
use crate::sync::descarga::ResultadoDescarga;
use crate::sync::motor::{ciclo, enviar_pendientes, Espera};
use crate::sync::outbox::{self, conteos, encolar};
use crate::sync::pruebas_util::*;
use crate::sync::transporte::{ErrorTransporte, Peticion, Transporte};

/// Servidor de pruebas en memoria con las mismas reglas de `/sync/push`: recuerda lo recibido por
/// id y responde `duplicada` si se repite. Permite cortar la red y perder respuestas.
#[derive(Default)]
struct ServidorDePrueba {
    recibidas: Mutex<Vec<String>>,
    resultado_por_id: Mutex<HashMap<String, String>>,
    /// ids que el servidor rechaza como inválidos
    invalidas: Mutex<Vec<String>>,
    sin_red: AtomicBool,
    /// La próxima respuesta se pierde: el servidor sí recibió, la estación no se entera.
    perder_respuesta: AtomicBool,
    envios: AtomicUsize,
    tamanos: Mutex<Vec<usize>>,
    descarga_bloqueada: AtomicBool,
}

impl Transporte for ServidorDePrueba {
    fn enviar(&self, _base: &str, p: Peticion<'_>) -> Result<Value, ErrorTransporte> {
        if self.sin_red.load(Ordering::SeqCst) {
            return Err(sin_conexion());
        }
        if p.ruta == "/sync/pull" {
            if self.descarga_bloqueada.load(Ordering::SeqCst) {
                return Err(error_servidor(403, "GIMNASIO_SUSPENDIDO", Some(json!({ "motivo": "falta_pago" }))));
            }
            return Ok(pagina("c", false, json!({})));
        }
        self.envios.fetch_add(1, Ordering::SeqCst);
        let ops = p.cuerpo.unwrap()["operaciones"].as_array().unwrap().clone();
        self.tamanos.lock().unwrap().push(ops.len());
        let mut resultados = Vec::new();
        let mut sin_resolver: Vec<String> = Vec::new();
        for (indice, op) in ops.iter().enumerate() {
            let id = op["id"].as_str().unwrap().to_string();
            let previo = self.resultado_por_id.lock().unwrap().get(&id).cloned();
            let deps: Vec<String> = op["depende_de"].as_array().unwrap().iter().map(|d| d.as_str().unwrap().to_string()).collect();
            let r = if let Some(original) = previo {
                json!({ "indice": indice, "id": id, "resultado": "duplicada", "resultado_original": original })
            } else if self.invalidas.lock().unwrap().contains(&id) {
                sin_resolver.push(id.clone());
                json!({ "indice": indice, "id": id, "resultado": "invalida", "codigo": "PAYLOAD_INVALIDO", "mensaje": "inválida (prueba)" })
            } else if deps.iter().any(|d| sin_resolver.contains(d) || !self.resultado_por_id.lock().unwrap().contains_key(d)) {
                sin_resolver.push(id.clone());
                json!({ "indice": indice, "id": id, "resultado": "retenida", "codigo": "DEPENDENCIA_PENDIENTE", "mensaje": "retenida (prueba)" })
            } else {
                self.recibidas.lock().unwrap().push(id.clone());
                self.resultado_por_id.lock().unwrap().insert(id.clone(), "aplicada".into());
                json!({ "indice": indice, "id": id, "resultado": "aplicada" })
            };
            resultados.push(r);
        }
        if self.perder_respuesta.swap(false, Ordering::SeqCst) {
            return Err(sin_conexion());
        }
        Ok(json!({ "resultados": resultados, "servidor_ahora": "2026-11-12T15:00:00Z" }))
    }
}

fn op(conn: &Connection, r: &dyn Reloj, n: usize, depende_de: &[String]) -> String {
    encolar(conn, r.ahora(), "auditoria_estacion", None, depende_de, &json!({ "accion": "CERRAR_SESION", "entidad": "x", "detalle": { "n": n } })).unwrap()
}

fn estados(conn: &Connection) -> Vec<String> {
    let mut stmt = conn.prepare("SELECT estado FROM sync_outbox ORDER BY secuencia").unwrap();
    let filas = stmt.query_map([], |f| f.get(0)).unwrap();
    filas.map(|e| e.unwrap()).collect()
}

/// La base de pruebas ya trae en cola el evento CREAR_BASE_LOCAL; se marca aplicado para contar limpio.
fn base_con_cola_vacia() -> (tempfile::TempDir, Mutex<Connection>) {
    let (dir, base) = base_activada();
    base.lock().unwrap().execute("UPDATE sync_outbox SET estado = 'aplicada'", []).unwrap();
    (dir, base)
}

#[test]
fn cada_evento_de_auditoria_se_encola_en_la_misma_transaccion() {
    let (_dir, base) = base_con_cola_vacia();
    let conn = base.lock().unwrap();

    let tx = conn.unchecked_transaction().unwrap();
    auditoria::registrar(&tx, reloj().ahora(), Actor::persona(ANA, "Ana"), "INICIAR_SESION", "staff_local", Some(ANA), &json!({ "metodo": "pin" })).unwrap();
    drop(tx); // sin confirmar: se deshace todo
    assert_eq!(conteos(&conn).unwrap().por_enviar, 0);
    let en_auditoria: i64 = conn.query_row("SELECT count(*) FROM auditoria_local WHERE accion = 'INICIAR_SESION'", [], |f| f.get(0)).unwrap();
    assert_eq!(en_auditoria, 0);

    auditoria::registrar(&conn, reloj().ahora(), Actor::persona(ANA, "Ana"), "INICIAR_SESION", "staff_local", Some(ANA), &json!({ "metodo": "pin" })).unwrap();
    assert_eq!(conteos(&conn).unwrap().por_enviar, 1);
    let (tipo, staff, payload): (String, String, String) =
        conn.query_row("SELECT tipo, staff_id, payload FROM sync_outbox WHERE estado = 'pendiente'", [], |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?))).unwrap();
    let payload: Value = serde_json::from_str(&payload).unwrap();
    assert_eq!((tipo.as_str(), staff.as_str()), ("auditoria_estacion", ANA));
    assert_eq!((payload["accion"].as_str(), payload["detalle"]["metodo"].as_str()), (Some("INICIAR_SESION"), Some("pin")));

    // Un evento que no es de los que suben no se encola.
    auditoria::registrar(&conn, reloj().ahora(), Actor::sistema(), "EVENTO_SOLO_LOCAL", "x", None, &json!({})).unwrap();
    assert_eq!(conteos(&conn).unwrap().por_enviar, 1);
}

#[test]
fn la_base_nueva_ya_trae_en_cola_su_evento_de_creacion() {
    let (_dir, base) = base_activada();
    assert_eq!(conteos(&base.lock().unwrap()).unwrap().por_enviar, 1);
}

#[test]
fn lo_pendiente_se_sube_en_orden_y_por_lotes_de_50() {
    let (_dir, base) = base_con_cola_vacia();
    let r = reloj();
    let ids: Vec<String> = { let conn = base.lock().unwrap(); (0..120).map(|n| op(&conn, &r, n, &[])).collect() };
    let servidor = ServidorDePrueba::default();

    let resumen = enviar_pendientes(&base, &servidor, &r).unwrap();
    assert_eq!(resumen.resueltas, 120);
    assert_eq!(*servidor.tamanos.lock().unwrap(), vec![50, 50, 20]);
    assert_eq!(*servidor.recibidas.lock().unwrap(), ids, "el servidor recibe en el mismo orden en que ocurrió");
    let c = conteos(&base.lock().unwrap()).unwrap();
    assert_eq!((c.por_enviar, c.con_error), (0, 0));
}

#[test]
fn sin_red_nada_se_pierde_y_al_volver_se_sube_todo_una_sola_vez() {
    let (_dir, base) = base_con_cola_vacia();
    let r = reloj();
    let servidor = ServidorDePrueba::default();
    servidor.sin_red.store(true, Ordering::SeqCst);
    { let conn = base.lock().unwrap(); for n in 0..7 { op(&conn, &r, n, &[]); } }

    for _ in 0..3 {
        assert!(enviar_pendientes(&base, &servidor, &r).unwrap_err().es_sin_conexion());
        assert_eq!(estados(&base.lock().unwrap())[1..], vec!["pendiente"; 7]);
    }
    servidor.sin_red.store(false, Ordering::SeqCst);
    assert_eq!(enviar_pendientes(&base, &servidor, &r).unwrap().resueltas, 7);
    assert_eq!(servidor.recibidas.lock().unwrap().len(), 7);
    // Otro ciclo no reenvía nada.
    assert_eq!(enviar_pendientes(&base, &servidor, &r).unwrap().resueltas, 0);
    assert_eq!(servidor.envios.load(Ordering::SeqCst), 1);
}

#[test]
fn si_la_respuesta_se_pierde_el_reenvio_no_duplica() {
    let (_dir, base) = base_con_cola_vacia();
    let r = reloj();
    let servidor = ServidorDePrueba::default();
    { let conn = base.lock().unwrap(); for n in 0..5 { op(&conn, &r, n, &[]); } }

    servidor.perder_respuesta.store(true, Ordering::SeqCst);
    assert!(enviar_pendientes(&base, &servidor, &r).is_err());
    assert_eq!(servidor.recibidas.lock().unwrap().len(), 5, "el servidor sí las recibió");
    assert_eq!(conteos(&base.lock().unwrap()).unwrap().por_enviar, 5, "la estación no lo sabe: siguen pendientes");

    assert_eq!(enviar_pendientes(&base, &servidor, &r).unwrap().resueltas, 5);
    assert_eq!(servidor.recibidas.lock().unwrap().len(), 5, "el reenvío llegó como duplicado, sin repetir");
    assert_eq!(conteos(&base.lock().unwrap()).unwrap().por_enviar, 0);
}

#[test]
fn si_la_app_se_cierra_a_mitad_de_envio_al_abrir_se_reenvia_sin_duplicar() {
    let (_dir, base) = base_con_cola_vacia();
    let r = reloj();
    let servidor = ServidorDePrueba::default();
    { let conn = base.lock().unwrap(); for n in 0..4 { op(&conn, &r, n, &[]); } }

    // La app tomó el lote y lo mandó; el servidor lo recibió; la app se cerró antes de guardar la respuesta.
    let lote = outbox::tomar_lote(&base.lock().unwrap(), 50).unwrap();
    let cuerpo = json!({ "operaciones": lote.iter().map(|o| o.cuerpo.clone()).collect::<Vec<_>>() });
    servidor.enviar("x", Peticion { metodo: crate::sync::transporte::Metodo::Post, ruta: "/sync/push", token: None, consulta: vec![], cuerpo: Some(&cuerpo) }).unwrap();
    assert_eq!(estados(&base.lock().unwrap())[1..], vec!["enviando"; 4]);

    // Al abrir de nuevo.
    assert_eq!(outbox::recuperar_enviando(&base.lock().unwrap()).unwrap(), 4);
    assert_eq!(enviar_pendientes(&base, &servidor, &r).unwrap().resueltas, 4);
    assert_eq!(servidor.recibidas.lock().unwrap().len(), 4);
}

#[test]
fn una_operacion_invalida_queda_como_error_y_nunca_se_borra() {
    let (_dir, base) = base_con_cola_vacia();
    let r = reloj();
    let servidor = ServidorDePrueba::default();
    let mala = { let conn = base.lock().unwrap(); let a = op(&conn, &r, 0, &[]); op(&conn, &r, 1, &[]); a };
    servidor.invalidas.lock().unwrap().push(mala.clone());

    let resumen = enviar_pendientes(&base, &servidor, &r).unwrap();
    assert_eq!((resumen.con_error, resumen.resueltas), (1, 1));
    let conn = base.lock().unwrap();
    assert_eq!(estados(&conn)[1..], ["error", "aplicada"]);
    let (codigo, mensaje): (String, String) =
        conn.query_row("SELECT ultimo_error_codigo, ultimo_error_mensaje FROM sync_outbox WHERE id = ?1", [&mala], |f| Ok((f.get(0)?, f.get(1)?))).unwrap();
    assert_eq!((codigo.as_str(), mensaje.as_str()), ("PAYLOAD_INVALIDO", "inválida (prueba)"));
    assert_eq!(conteos(&conn).unwrap().con_error, 1);

    assert!(conn.execute("DELETE FROM sync_outbox WHERE id = ?1", [&mala]).is_err(), "la cola no se borra");
    drop(conn);
    // Los ciclos siguientes no la reenvían ni la descartan.
    enviar_pendientes(&base, &servidor, &r).unwrap();
    assert_eq!(servidor.envios.load(Ordering::SeqCst), 1);
    assert_eq!(conteos(&base.lock().unwrap()).unwrap().con_error, 1);
}

#[test]
fn lo_que_depende_de_un_error_queda_retenido_y_no_sale_suelto() {
    let (_dir, base) = base_con_cola_vacia();
    let r = reloj();
    let servidor = ServidorDePrueba::default();
    let (a, b, _c, d) = {
        let conn = base.lock().unwrap();
        let a = op(&conn, &r, 0, &[]);
        let b = op(&conn, &r, 1, &[a.clone()]);
        let c = op(&conn, &r, 2, &[b.clone()]);
        let d = op(&conn, &r, 3, &[]);
        (a, b, c, d)
    };
    servidor.invalidas.lock().unwrap().push(a.clone());

    enviar_pendientes(&base, &servidor, &r).unwrap();
    assert_eq!(estados(&base.lock().unwrap())[1..], ["error", "retenida", "retenida", "aplicada"]);
    assert_eq!(*servidor.recibidas.lock().unwrap(), vec![d.clone()]);

    // Mientras la primera siga en error, las retenidas ni siquiera salen de la estación.
    let antes = servidor.envios.load(Ordering::SeqCst);
    enviar_pendientes(&base, &servidor, &r).unwrap();
    assert_eq!(servidor.envios.load(Ordering::SeqCst), antes);

    // Resuelto el error (ya es válida y se vuelve a intentar), entran las tres y en orden.
    servidor.invalidas.lock().unwrap().clear();
    base.lock().unwrap().execute("UPDATE sync_outbox SET estado = 'pendiente' WHERE id = ?1", [&a]).unwrap();
    enviar_pendientes(&base, &servidor, &r).unwrap();
    assert_eq!(estados(&base.lock().unwrap())[1..], ["aplicada"; 4]);
    assert_eq!(servidor.recibidas.lock().unwrap()[1..], [a, b.clone(), _c]);
    let _ = b;
}

#[test]
fn con_el_gimnasio_bloqueado_lo_pendiente_se_sube_igual() {
    let (_dir, base) = base_con_cola_vacia();
    let r = reloj();
    let servidor = ServidorDePrueba::default();
    servidor.descarga_bloqueada.store(true, Ordering::SeqCst);
    { let conn = base.lock().unwrap(); for n in 0..3 { op(&conn, &r, n, &[]); } }

    let resultado = ciclo(&base, &servidor, &r).unwrap();
    assert_eq!(resultado.envio.resueltas, 3);
    assert_eq!(resultado.descarga, ResultadoDescarga::GimnasioBloqueado);
    assert_eq!(servidor.recibidas.lock().unwrap().len(), 3);
}

#[test]
fn una_operacion_marcada_por_revisar_queda_visible_y_no_se_reenvia() {
    let (_dir, base) = base_con_cola_vacia();
    let r = reloj();
    let id = op(&base.lock().unwrap(), &r, 0, &[]);
    let t = TransporteGuion::con(vec![Ok(json!({ "resultados": [{
        "indice": 0, "id": id, "resultado": "pendiente_revision",
        "revision": { "motivo_codigo": "STAFF_DESACTIVADO", "motivo": "Ana usó la estación y figura desactivada." }
    }] }))]);

    let resumen = enviar_pendientes(&base, &t, &r).unwrap();
    assert_eq!(resumen.por_revisar, 1);
    let conn = base.lock().unwrap();
    let c = conteos(&conn).unwrap();
    assert_eq!((c.por_revisar, c.por_enviar), (1, 0));
    let motivo: String = conn.query_row("SELECT ultimo_error_mensaje FROM sync_outbox WHERE id = ?1", [&id], |f| f.get(0)).unwrap();
    assert_eq!(motivo, "Ana usó la estación y figura desactivada.");
}

#[test]
fn la_espera_crece_con_cada_fallo_y_se_reinicia_con_un_exito() {
    let mut e = Espera::default();
    let segundos: Vec<u64> = (0..8).map(|_| e.siguiente(false).as_secs()).collect();
    assert_eq!(segundos, vec![5, 10, 20, 40, 80, 160, 300, 300]);
    assert_eq!(e.siguiente(true), Duration::from_secs(30));
    assert_eq!(e.siguiente(false).as_secs(), 5);
}

#[test]
fn la_lista_de_pendientes_muestra_primero_los_errores_y_oculta_lo_ya_subido() {
    let (_dir, base) = base_con_cola_vacia();
    let r = reloj();
    let servidor = ServidorDePrueba::default();
    let mala = { let conn = base.lock().unwrap(); op(&conn, &r, 0, &[]); let m = op(&conn, &r, 1, &[]); op(&conn, &r, 2, &[]); m };
    servidor.invalidas.lock().unwrap().push(mala.clone());
    enviar_pendientes(&base, &servidor, &r).unwrap();
    let conn = base.lock().unwrap();
    let nueva = op(&conn, &r, 3, &[]);

    let pagina = outbox::listar(&conn, false, 20, 0).unwrap();
    assert_eq!(pagina.total, 2);
    assert_eq!(pagina.items.iter().map(|i| (i.id.as_str(), i.estado.as_str())).collect::<Vec<_>>(), [(mala.as_str(), "error"), (nueva.as_str(), "pendiente")]);
    assert_eq!(pagina.items[0].accion.as_deref(), Some("CERRAR_SESION"));
    assert_eq!(pagina.items[0].mensaje.as_deref(), Some("inválida (prueba)"));

    // Con el historial se ve todo, incluido lo aplicado; nada se borró.
    assert_eq!(outbox::listar(&conn, true, 20, 0).unwrap().total, 5);
    assert_eq!(outbox::listar(&conn, true, 2, 4).unwrap().items.len(), 1);
}

#[test]
fn reintentar_solo_aplica_a_lo_que_esta_en_error() {
    let (_dir, base) = base_con_cola_vacia();
    let r = reloj();
    let servidor = ServidorDePrueba::default();
    let (mala, buena) = { let conn = base.lock().unwrap(); (op(&conn, &r, 0, &[]), op(&conn, &r, 1, &[])) };
    servidor.invalidas.lock().unwrap().push(mala.clone());
    enviar_pendientes(&base, &servidor, &r).unwrap();

    {
        let conn = base.lock().unwrap();
        assert_eq!(outbox::reintentar(&conn, &buena).unwrap_err().codigo, "OPERACION_NO_REINTENTABLE");
        outbox::reintentar(&conn, &mala).unwrap();
        assert_eq!(estados(&conn)[1..], ["pendiente", "aplicada"]);
    }
    servidor.invalidas.lock().unwrap().clear();
    assert_eq!(enviar_pendientes(&base, &servidor, &r).unwrap().resueltas, 1);
}
