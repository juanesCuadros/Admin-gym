//! Comandos que la interfaz puede invocar. Son la única puerta entre React y la base local.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;

use crate::acceso::registro::{self, ClienteEvaluado, Objetivo, ResultadoIngreso, ResumenIngresos};
use crate::error::{ErrorApp, Resultado};
use crate::reloj::{fecha_negocio, Reloj};
use crate::sesion::{self, Credencial, EstadoSesion, GestorSesion, PersonaConPin};
use crate::sync::suscripcion::{self, EstadoSuscripcion};
use crate::sync::transporte::Transporte;
use crate::sync::motor::{self, Espera};
use crate::sync::outbox::{self, ConteosCola, PaginaCola};
use crate::sync::{activacion, exigir_operable, ingreso};

/// Lo que se sabe de la sincronización mientras la app está abierta.
#[derive(Default)]
pub struct EstadoSync {
    pub en_curso: AtomicBool,
    /// `false` desde el último intento sin respuesta del servidor.
    pub en_linea: AtomicBool,
    pub ultimo_error: Mutex<Option<ErrorApp>>,
    /// Despierta al hilo de sincronización antes de que se cumpla su espera.
    despertador: Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

pub struct EstadoApp {
    /// Si la base no abrió, se conserva el motivo para mostrarlo en pantalla.
    pub base: Resultado<Arc<Mutex<Connection>>>,
    pub sesion: Arc<Mutex<GestorSesion>>,
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
            sesion: Arc::new(Mutex::new(GestorSesion::default())),
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

    /// Arranca el hilo que sincroniza mientras la app esté abierta: sube lo pendiente y descarga
    /// lo que cambió, cada 30 s, con espera creciente cuando no hay red.
    pub fn iniciar_motor(&self) -> Resultado<()> {
        let base = self.base()?.clone();
        {
            let conn = base.lock().map_err(|_| error_interno())?;
            // Si la app se cerró a mitad de un envío, eso vuelve a la cola.
            outbox::recuperar_enviando(&conn)?;
        }
        let (emisor, receptor) = std::sync::mpsc::channel::<()>();
        *self.sync.despertador.lock().map_err(|_| error_interno())? = Some(emisor);
        let (transporte, reloj, sync, sesion) = (self.transporte.clone(), self.reloj.clone(), self.sync.clone(), self.sesion.clone());
        std::thread::spawn(move || {
            let mut espera = Espera::default();
            loop {
                sync.en_curso.store(true, Ordering::SeqCst);
                let resultado = motor::ciclo(&base, transporte.as_ref(), reloj.as_ref());
                // Si a quien tiene la sesión lo desactivaron o cambió su contraseña en la web, se le cierra.
                if let (Ok(mut gestor), Ok(conn)) = (sesion.lock(), base.lock()) {
                    let _ = gestor.revalidar(&conn, reloj.ahora());
                }
                let sin_conexion = matches!(&resultado, Err(e) if e.es_sin_conexion());
                sync.en_linea.store(!sin_conexion, Ordering::SeqCst);
                let exito = resultado.is_ok();
                *sync.ultimo_error.lock().unwrap_or_else(|e| e.into_inner()) = resultado.err().map(|e| e.a_error_app());
                sync.en_curso.store(false, Ordering::SeqCst);

                match receptor.recv_timeout(espera.siguiente(exito)) {
                    Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                    Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                }
                // Varios avisos seguidos cuentan como uno.
                while receptor.try_recv().is_ok() {}
            }
        });
        Ok(())
    }

    /// Pide sincronizar ya (tras activar, al cobrar, o con el botón de la pantalla).
    pub fn despertar(&self) {
        if let Ok(guardia) = self.sync.despertador.lock() {
            if let Some(emisor) = guardia.as_ref() {
                let _ = emisor.send(());
            }
        }
    }
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
    pub cola: ConteosCola,
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
        let cola = outbox::conteos(conn)?;
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
                    cola,
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
    estado.sync.en_curso.store(true, Ordering::SeqCst);
    estado.despertar();
    Ok(())
}

#[tauri::command]
pub fn sincronizar_ahora(estado: State<'_, EstadoApp>) -> Resultado<()> {
    estado.base()?;
    estado.sync.en_curso.store(true, Ordering::SeqCst);
    estado.despertar();
    Ok(())
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

/// Puede salir a la red (primer ingreso de la persona en esta estación): por eso es `async`.
#[tauri::command(async)]
pub fn iniciar_sesion_password(estado: State<'_, EstadoApp>, correo: String, password: String) -> Resultado<EstadoSesion> {
    ingreso::iniciar_con_password(estado.base()?, &estado.sesion, estado.transporte.as_ref(), estado.reloj.as_ref(), &correo, &password)
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

/// Lo que falta por subir, los errores y lo que quedó por revisar. Exige sesión abierta.
#[tauri::command]
pub fn cola_pendientes(estado: State<'_, EstadoApp>, incluir_aplicadas: bool, limite: i64, desplazamiento: i64) -> Resultado<PaginaCola> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        outbox::listar(conn, incluir_aplicadas, limite, desplazamiento)
    })
}

#[tauri::command]
pub fn reintentar_operacion(estado: State<'_, EstadoApp>, id: String) -> Resultado<()> {
    estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        let tx = conn.unchecked_transaction()?;
        outbox::reintentar(&tx, &id)?;
        crate::auditoria::registrar(
            &tx,
            ahora,
            crate::auditoria::Actor::persona(&usuario.id, &usuario.nombre),
            "REINTENTAR_OPERACION",
            "sync_outbox",
            Some(&id),
            &serde_json::json!({}),
        )?;
        tx.commit()?;
        Ok(())
    })?;
    estado.despertar();
    Ok(())
}

// --- Control de ingreso (fase 2) ---

/// Busca clientes por nombre o documento en la base local. Cada uno trae ya su estado de acceso.
#[tauri::command]
pub fn buscar_clientes(estado: State<'_, EstadoApp>, texto: String) -> Resultado<Vec<ClienteEvaluado>> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        exigir_operable(conn, ahora)?;
        registro::buscar(conn, &texto, fecha_negocio(ahora))
    })
}

/// Registra un intento de ingreso con los datos locales, con red o sin ella, y lo deja en la cola.
/// Recibe el id del cliente (elegido de la búsqueda) o su documento (escrito o leído por el lector).
#[tauri::command]
pub fn registrar_ingreso(estado: State<'_, EstadoApp>, deportista_id: Option<String>, documento: Option<String>) -> Resultado<ResultadoIngreso> {
    let resultado = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        exigir_operable(conn, ahora)?;
        let objetivo = match (deportista_id.as_deref(), documento.as_deref()) {
            (Some(id), _) => Objetivo::Id(id),
            (None, Some(doc)) if !doc.trim().is_empty() => Objetivo::Documento(doc),
            _ => return Err(ErrorApp::nuevo("DATOS_INCOMPLETOS", "Escribe el documento del cliente o búscalo por su nombre.")),
        };
        registro::registrar_ingreso(conn, ahora, &usuario, objetivo, "manual")
    })?;
    if !resultado.relectura_ignorada {
        estado.despertar();
    }
    Ok(resultado)
}

#[tauri::command]
pub fn registrar_cortesia(estado: State<'_, EstadoApp>, motivo: String) -> Resultado<ResultadoIngreso> {
    let resultado = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        exigir_operable(conn, ahora)?;
        registro::registrar_cortesia(conn, ahora, &usuario, &motivo)
    })?;
    estado.despertar();
    Ok(resultado)
}

/// Lo que esta estación registró hoy, con sus conteos.
#[tauri::command]
pub fn ingresos_de_hoy(estado: State<'_, EstadoApp>) -> Resultado<ResumenIngresos> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        registro::ingresos_del_dia(conn, ahora)
    })
}
