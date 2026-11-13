//! Comandos que la interfaz puede invocar. Son la única puerta entre React y la base local.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::error::{ErrorApp, Resultado};
use crate::reloj::{fecha_negocio, Reloj};
use crate::sesion::{self, Credencial, EstadoSesion, GestorSesion, PersonaConPin};
use crate::sync::suscripcion::{self, EstadoSuscripcion};
use crate::sync::transporte::Transporte;
use crate::sync::{activacion, descarga};

/// Lo que se sabe de la sincronización mientras la app está abierta.
#[derive(Default)]
pub struct EstadoSync {
    pub en_curso: AtomicBool,
    /// `false` desde el último intento sin respuesta del servidor.
    pub en_linea: AtomicBool,
    pub ultimo_error: Mutex<Option<ErrorApp>>,
}

pub struct EstadoApp {
    /// Si la base no abrió, se conserva el motivo para mostrarlo en pantalla.
    pub base: Resultado<Arc<Mutex<Connection>>>,
    pub sesion: Mutex<GestorSesion>,
    pub reloj: Arc<dyn Reloj>,
    pub transporte: Arc<dyn Transporte>,
    pub sync: Arc<EstadoSync>,
}

fn error_interno() -> ErrorApp {
    ErrorApp::nuevo("ERROR_INTERNO", "GymDesk tuvo un error interno. Cierra y vuelve a abrir la aplicación.")
}

impl EstadoApp {
    pub fn nuevo(base: Resultado<Connection>, reloj: Arc<dyn Reloj>, transporte: Arc<dyn Transporte>) -> Self {
        Self {
            base: base.map(|c| Arc::new(Mutex::new(c))),
            sesion: Mutex::new(GestorSesion::default()),
            reloj,
            transporte,
            sync: Arc::new(EstadoSync::default()),
        }
    }

    pub fn base(&self) -> Resultado<&Arc<Mutex<Connection>>> {
        self.base.as_ref().map_err(|e| e.clone())
    }

    /// Orden de candados: primero la sesión, después la base.
    fn con_base<T>(&self, f: impl FnOnce(&Connection, &mut GestorSesion, DateTime<Utc>) -> Resultado<T>) -> Resultado<T> {
        let mut sesion = self.sesion.lock().map_err(|_| error_interno())?;
        let conn = self.base()?.lock().map_err(|_| error_interno())?;
        f(&conn, &mut sesion, self.reloj.ahora())
    }

    /// Lanza una ronda de descarga en otro hilo. Si ya hay una en curso, no hace nada.
    pub fn descargar_en_segundo_plano(&self) -> Resultado<()> {
        let base = self.base()?.clone();
        if self.sync.en_curso.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let (transporte, reloj, sync) = (self.transporte.clone(), self.reloj.clone(), self.sync.clone());
        std::thread::spawn(move || {
            let resultado = descarga::descargar(&base, transporte.as_ref(), reloj.as_ref());
            sync.en_linea.store(!matches!(&resultado, Err(e) if e.es_sin_conexion()), Ordering::SeqCst);
            *sync.ultimo_error.lock().unwrap_or_else(|e| e.into_inner()) = resultado.err().map(|e| e.a_error_app());
            sync.en_curso.store(false, Ordering::SeqCst);
        });
        Ok(())
    }
}

/// Activada, sin revocar y con el servicio del gimnasio al día: condición para iniciar sesión.
fn exigir_operable(conn: &Connection, ahora: DateTime<Utc>) -> Resultado<()> {
    let (activada, revocada): (bool, bool) =
        conn.query_row("SELECT activada_en IS NOT NULL, revocada_en IS NOT NULL FROM estacion WHERE id = 1", [], |f| {
            Ok((f.get(0)?, f.get(1)?))
        })?;
    if !activada {
        return Err(ErrorApp::nuevo("ESTACION_SIN_ACTIVAR", "Esta estación aún no está activada."));
    }
    if revocada {
        return Err(ErrorApp::nuevo("ESTACION_REVOCADA", "El Jefe del gimnasio revocó esta estación."));
    }
    let s = suscripcion::estado_actual(conn, fecha_negocio(ahora))?;
    if s.estado == "bloqueado" {
        return Err(ErrorApp::con_detalles(
            "GIMNASIO_SUSPENDIDO",
            "El servicio del gimnasio no está disponible.",
            serde_json::json!({ "motivo": s.motivo_bloqueo }),
        ));
    }
    Ok(())
}

#[derive(Serialize)]
pub struct ConteosLocales {
    pub personal: i64,
    pub deportistas: i64,
    pub membresias: i64,
    pub planes: i64,
    pub productos: i64,
}

#[derive(Serialize)]
pub struct EstadoEstacion {
    pub activada: bool,
    pub revocada: bool,
    pub estacion_id: String,
    pub estacion_nombre: Option<String>,
    pub gimnasio_nombre: Option<String>,
    pub subdominio: Option<String>,
    pub version_app: &'static str,
    pub descarga_inicial_completa: bool,
    pub ultima_descarga_ok: Option<String>,
    pub conteos: ConteosLocales,
    pub suscripcion: EstadoSuscripcion,
    pub sincronizando: bool,
    pub en_linea: bool,
    pub error_sync: Option<ErrorApp>,
}

#[tauri::command]
pub fn estado_estacion(estado: State<'_, EstadoApp>) -> Resultado<EstadoEstacion> {
    let sync = estado.sync.clone();
    estado.con_base(|conn, _, ahora| {
        let contar = |tabla: &str| -> Resultado<i64> {
            // `tabla` solo recibe los literales de abajo.
            Ok(conn.query_row(&format!("SELECT count(*) FROM {tabla}"), [], |f| f.get(0))?)
        };
        let (completa, ultima): (bool, Option<String>) = conn.query_row(
            "SELECT descarga_inicial_completa, ultima_descarga_ok FROM sync_estado WHERE id = 1",
            [],
            |f| Ok((f.get(0)?, f.get(1)?)),
        )?;
        let conteos = ConteosLocales {
            personal: contar("staff_local WHERE eliminado = 0")?,
            deportistas: contar("deportistas WHERE eliminado = 0")?,
            membresias: contar("membresias")?,
            planes: contar("planes")?,
            productos: contar("productos")?,
        };
        let suscripcion = suscripcion::estado_actual(conn, fecha_negocio(ahora))?;
        Ok(conn.query_row(
            "SELECT activada_en IS NOT NULL, revocada_en IS NOT NULL, estacion_id, estacion_nombre, gimnasio_nombre, subdominio
             FROM estacion WHERE id = 1",
            [],
            |f| {
                Ok(EstadoEstacion {
                    activada: f.get(0)?,
                    revocada: f.get(1)?,
                    estacion_id: f.get(2)?,
                    estacion_nombre: f.get(3)?,
                    gimnasio_nombre: f.get(4)?,
                    subdominio: f.get(5)?,
                    version_app: env!("CARGO_PKG_VERSION"),
                    descarga_inicial_completa: completa,
                    ultima_descarga_ok: ultima,
                    conteos,
                    suscripcion,
                    sincronizando: sync.en_curso.load(Ordering::SeqCst),
                    en_linea: sync.en_linea.load(Ordering::SeqCst),
                    error_sync: sync.ultimo_error.lock().unwrap_or_else(|e| e.into_inner()).clone(),
                })
            },
        )?)
    })
}

/// Activa la estación y arranca la descarga inicial. Es bloqueante (sale a la red): por eso es `async`.
#[tauri::command(async)]
pub fn activar_estacion(estado: State<'_, EstadoApp>, subdominio: String, codigo: String) -> Resultado<()> {
    activacion::activar(estado.base()?, estado.transporte.as_ref(), estado.reloj.as_ref(), &subdominio, &codigo)?;
    estado.sync.en_linea.store(true, Ordering::SeqCst);
    estado.descargar_en_segundo_plano()
}

#[tauri::command]
pub fn sincronizar_ahora(estado: State<'_, EstadoApp>) -> Resultado<()> {
    estado.descargar_en_segundo_plano()
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
    estado.con_base(|conn, sesion, ahora| {
        exigir_operable(conn, ahora)?;
        sesion.iniciar_con_password(conn, ahora, &correo, &password)
    })
}

#[tauri::command]
pub fn iniciar_sesion_pin(estado: State<'_, EstadoApp>, staff_id: String, pin: String) -> Resultado<EstadoSesion> {
    estado.con_base(|conn, sesion, ahora| {
        exigir_operable(conn, ahora)?;
        sesion.iniciar_con_pin(conn, ahora, &staff_id, &pin)
    })
}

#[tauri::command]
pub fn desbloquear_sesion(estado: State<'_, EstadoApp>, pin: Option<String>, password: Option<String>) -> Resultado<EstadoSesion> {
    estado.con_base(|conn, sesion, ahora| {
        exigir_operable(conn, ahora)?;
        match (pin.as_deref(), password.as_deref()) {
            (Some(pin), None) => sesion.desbloquear(conn, ahora, Credencial::Pin(pin)),
            (None, Some(password)) => sesion.desbloquear(conn, ahora, Credencial::Password(password)),
            _ => Err(ErrorApp::nuevo("DATOS_INCOMPLETOS", "Escribe tu PIN o tu contraseña.")),
        }
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
