//! Ayudas para las pruebas de sincronización. Solo se compila con `cargo test`.

use std::collections::VecDeque;
use std::sync::Mutex;

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::db::pruebas::base_temporal;
use crate::sync::transporte::{ErrorTransporte, Peticion, Transporte};

/// Transporte de pruebas que responde, en orden, lo que el caso le dejó preparado, y recuerda
/// qué se le pidió. Permite reproducir cortes de red y respuestas del servidor una a una.
#[derive(Default)]
pub struct TransporteGuion {
    respuestas: Mutex<VecDeque<Result<Value, ErrorTransporte>>>,
    pub pedidos: Mutex<Vec<(String, Option<String>, Vec<(String, String)>, Option<Value>)>>,
}

impl TransporteGuion {
    pub fn con(respuestas: Vec<Result<Value, ErrorTransporte>>) -> Self {
        Self { respuestas: Mutex::new(respuestas.into()), pedidos: Mutex::default() }
    }

    pub fn agregar(&self, r: Result<Value, ErrorTransporte>) {
        self.respuestas.lock().unwrap().push_back(r);
    }

    pub fn rutas(&self) -> Vec<String> {
        self.pedidos.lock().unwrap().iter().map(|p| p.0.clone()).collect()
    }
}

impl Transporte for TransporteGuion {
    fn enviar(&self, _base: &str, p: Peticion<'_>) -> Result<Value, ErrorTransporte> {
        self.pedidos.lock().unwrap().push((
            p.ruta.to_string(),
            p.token.map(str::to_string),
            p.consulta.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
            p.cuerpo.cloned(),
        ));
        self.respuestas.lock().unwrap().pop_front().unwrap_or_else(|| Err(sin_conexion()))
    }
}

pub fn sin_conexion() -> ErrorTransporte {
    ErrorTransporte::SinConexion("sin red (prueba)".into())
}

pub fn error_servidor(status: u16, codigo: &str, detalles: Option<Value>) -> ErrorTransporte {
    ErrorTransporte::Servidor { status, codigo: codigo.into(), mensaje: format!("mensaje de {codigo}"), detalles }
}

pub const GYM: &str = "11111111-1111-1111-1111-111111111111";
pub const ANA: &str = "22222222-2222-2222-2222-222222222222";

/// Respuesta de `/sync/activar` como la da el servidor.
pub fn respuesta_activar() -> Value {
    json!({
        "estacion_id": "33333333-3333-3333-3333-333333333333",
        "nombre": "Recepción",
        "device_token": "token-de-la-estacion",
        "gimnasio": { "id": GYM, "nombre": "Power Gym", "subdominio": "powergym" }
    })
}

pub fn fila_gimnasio() -> Value {
    json!({
        "id": GYM, "nombre": "Power Gym", "subdominio": "powergym", "zona_horaria": "America/Bogota",
        "dias_gracia_mora": 3, "dias_umbral_por_vencer": 5, "permitir_descuentos": false, "tope_descuento_pct": 0,
        "metodos_pago": ["efectivo", "nequi"], "branding": { "primary_color": "#123456" }, "duracion_sesion_minutos": 60
    })
}

pub fn fila_staff(id: &str, nombre: &str, correo: &str) -> Value {
    json!({ "id": id, "nombre": nombre, "correo": correo, "rol": "recepcionista", "activo": true, "eliminado": false, "password_cambiada_en": null })
}

/// Página de `/sync/pull` con los cambios indicados.
pub fn pagina(cursor: &str, hay_mas: bool, cambios: Value) -> Value {
    json!({
        "epoca": "e1", "reiniciar": false, "cursor": cursor, "hay_mas": hay_mas, "cambios": cambios, "eliminados": [],
        "suscripcion": { "estado_guardado": "activo", "fecha_corte": "2027-01-01", "estado_calculado": "al_dia", "motivo_bloqueo": null },
        "servidor_ahora": "2026-11-12T15:00:00Z"
    })
}

/// Base local ya activada contra el gimnasio de pruebas.
pub fn base_activada() -> (tempfile::TempDir, Mutex<Connection>) {
    let (dir, conn) = base_temporal();
    conn.execute(
        "UPDATE estacion SET gimnasio_id = ?1, subdominio = 'powergym', gimnasio_nombre = 'Power Gym',
           activada_en = '2026-11-12T15:00:00.000Z', estacion_servidor_id = '33333333-3333-3333-3333-333333333333',
           estacion_nombre = 'Recepción', device_token = 'token-de-la-estacion', api_base = 'http://prueba/api/v1'",
        [GYM],
    )
    .unwrap();
    (dir, Mutex::new(conn))
}
