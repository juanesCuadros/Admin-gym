//! Comandos que la interfaz puede invocar. Son la única puerta entre React y la base local.

use std::sync::Mutex;

use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::error::{ErrorApp, Resultado};
use crate::reloj::Reloj;
use crate::sesion::{self, Credencial, EstadoSesion, GestorSesion, PersonaConPin};

pub struct Interior {
    /// Si la base no abrió, se conserva el motivo para mostrarlo en pantalla.
    pub base: Resultado<Connection>,
    pub sesion: GestorSesion,
}

pub struct EstadoApp {
    pub interior: Mutex<Interior>,
    pub reloj: Box<dyn Reloj>,
}

impl EstadoApp {
    pub fn nuevo(base: Resultado<Connection>, reloj: Box<dyn Reloj>) -> Self {
        Self { interior: Mutex::new(Interior { base, sesion: GestorSesion::default() }), reloj }
    }

    fn con_base<T>(&self, f: impl FnOnce(&Connection, &mut GestorSesion, chrono::DateTime<chrono::Utc>) -> Resultado<T>) -> Resultado<T> {
        let mut guardia = self
            .interior
            .lock()
            .map_err(|_| ErrorApp::nuevo("ERROR_INTERNO", "GymDesk tuvo un error interno. Cierra y vuelve a abrir la aplicación."))?;
        let Interior { base, sesion } = &mut *guardia;
        match base {
            Ok(conn) => f(conn, sesion, self.reloj.ahora()),
            Err(e) => Err(e.clone()),
        }
    }
}

#[derive(Serialize)]
pub struct EstadoEstacion {
    pub activada: bool,
    pub estacion_id: String,
    pub gimnasio_nombre: Option<String>,
    pub subdominio: Option<String>,
    pub version_app: &'static str,
}

#[tauri::command]
pub fn estado_estacion(estado: State<'_, EstadoApp>) -> Resultado<EstadoEstacion> {
    estado.con_base(|conn, _, _| {
        Ok(conn.query_row(
            "SELECT activada_en IS NOT NULL, estacion_id, gimnasio_nombre, subdominio FROM estacion WHERE id = 1",
            [],
            |f| {
                Ok(EstadoEstacion {
                    activada: f.get(0)?,
                    estacion_id: f.get(1)?,
                    gimnasio_nombre: f.get(2)?,
                    subdominio: f.get(3)?,
                    version_app: env!("CARGO_PKG_VERSION"),
                })
            },
        )?)
    })
}

#[tauri::command]
pub fn estado_sesion(estado: State<'_, EstadoApp>) -> Resultado<EstadoSesion> {
    estado.con_base(|conn, sesion, ahora| sesion.estado(conn, ahora))
}

#[tauri::command]
pub fn registrar_actividad(estado: State<'_, EstadoApp>) -> Resultado<EstadoSesion> {
    estado.con_base(|conn, sesion, ahora| sesion.registrar_actividad(conn, ahora))
}

#[tauri::command]
pub fn personal_con_pin(estado: State<'_, EstadoApp>) -> Resultado<Vec<PersonaConPin>> {
    estado.con_base(|conn, _, _| sesion::personal_con_pin(conn))
}

#[tauri::command]
pub fn iniciar_sesion_password(estado: State<'_, EstadoApp>, correo: String, password: String) -> Resultado<EstadoSesion> {
    estado.con_base(|conn, sesion, ahora| sesion.iniciar_con_password(conn, ahora, &correo, &password))
}

#[tauri::command]
pub fn iniciar_sesion_pin(estado: State<'_, EstadoApp>, staff_id: String, pin: String) -> Resultado<EstadoSesion> {
    estado.con_base(|conn, sesion, ahora| sesion.iniciar_con_pin(conn, ahora, &staff_id, &pin))
}

#[tauri::command]
pub fn desbloquear_sesion(estado: State<'_, EstadoApp>, pin: Option<String>, password: Option<String>) -> Resultado<EstadoSesion> {
    estado.con_base(|conn, sesion, ahora| match (pin.as_deref(), password.as_deref()) {
        (Some(pin), None) => sesion.desbloquear(conn, ahora, Credencial::Pin(pin)),
        (None, Some(password)) => sesion.desbloquear(conn, ahora, Credencial::Password(password)),
        _ => Err(ErrorApp::nuevo("DATOS_INCOMPLETOS", "Escribe tu PIN o tu contraseña.")),
    })
}

#[tauri::command]
pub fn bloquear_sesion(estado: State<'_, EstadoApp>) -> Resultado<EstadoSesion> {
    estado.con_base(|conn, sesion, ahora| sesion.bloquear(conn, ahora))
}

#[tauri::command]
pub fn cerrar_sesion(estado: State<'_, EstadoApp>) -> Resultado<EstadoSesion> {
    estado.con_base(|conn, sesion, ahora| sesion.cerrar(conn, ahora))
}

#[tauri::command]
pub fn definir_pin(estado: State<'_, EstadoApp>, password_actual: String, pin: String) -> Resultado<EstadoSesion> {
    estado.con_base(|conn, sesion, ahora| sesion.definir_pin(conn, ahora, &password_actual, &pin))
}
