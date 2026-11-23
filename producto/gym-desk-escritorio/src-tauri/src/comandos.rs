//! Comandos que la interfaz puede invocar. Son la única puerta entre React y la base local.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use rusqlite::Connection;
use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::acceso::registro::{self, ClienteEvaluado, Objetivo, ResultadoIngreso, ResumenIngresos};
use crate::caja;
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
pub fn registrar_ingreso(app: tauri::AppHandle, estado: State<'_, EstadoApp>, deportista_id: Option<String>, documento: Option<String>) -> Resultado<ResultadoIngreso> {
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
    abrir_puerta_si_corresponde(&estado, &resultado);
    if !resultado.relectura_ignorada {
        estado.despertar();
        // La pantalla de bienvenida (TV) lo muestra al instante, sin pasar por el servidor.
        let _ = app.emit("ingreso-registrado", &resultado);
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

// --- Caja sin red (fase 3A) ---

#[derive(Serialize)]
pub struct EstadoCaja {
    pub turno: Option<caja::ResumenTurno>,
    pub mostrador: caja::DatosMostrador,
}

#[tauri::command]
pub fn caja_estado(estado: State<'_, EstadoApp>) -> Resultado<EstadoCaja> {
    estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        let turno = match caja::turno_abierto(conn)? {
            Some(t) => Some(caja::resumen(conn, &t.id)?),
            None => None,
        };
        Ok(EstadoCaja { turno, mostrador: caja::datos_mostrador(conn, &usuario)? })
    })
}

/// Con red, nada cambia (A1): se consulta al servidor y se rechaza si ya hay otro turno abierto en el
/// gimnasio. Sin red, se abre igual y queda marcado como "sin confirmar". Sale a la red: es `async`.
#[tauri::command(async)]
pub fn caja_abrir_turno(estado: State<'_, EstadoApp>, base_inicial: i64) -> Resultado<caja::ResumenTurno> {
    let credenciales = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        exigir_operable(conn, ahora)?;
        caja::exigir_permiso_caja(conn, &usuario)?;
        if caja::turno_abierto(conn)?.is_some() {
            return Err(ErrorApp::nuevo("TURNO_YA_ABIERTO", "Ya hay un turno de caja abierto en esta estación."));
        }
        crate::sync::descarga::credenciales(conn)
    })?;
    let confirmacion = caja::confirmar_turno_unico(estado.transporte.as_ref(), credenciales.as_ref())?;
    let resumen = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        caja::abrir_turno(conn, ahora, &usuario, base_inicial, confirmacion)
    })?;
    estado.despertar();
    Ok(resumen)
}

#[tauri::command]
pub fn caja_cerrar_turno(estado: State<'_, EstadoApp>, efectivo_contado: i64, nota: Option<String>) -> Resultado<caja::ResumenTurno> {
    let resumen = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        exigir_operable(conn, ahora)?;
        caja::cerrar_turno(conn, ahora, &usuario, efectivo_contado, nota.as_deref())
    })?;
    estado.despertar();
    Ok(resumen)
}

#[tauri::command]
pub fn caja_productos(estado: State<'_, EstadoApp>, texto: String) -> Resultado<Vec<caja::ProductoVenta>> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        caja::productos_para_venta(conn, &texto)
    })
}

/// Registra un cliente en el servidor, con foto opcional, y lo guarda en la estación (E-41). Exige conexión.
#[tauri::command]
pub fn registrar_cliente(
    estado: State<'_, EstadoApp>,
    cliente: serde_json::Value,
    foto: Option<String>,
) -> Resultado<ClienteEvaluado> {
    let r = crate::sync::clientes::registrar(estado.base()?, &estado.sesion, estado.transporte.as_ref(), estado.reloj.as_ref(), &cliente, foto.as_deref())?;
    estado.despertar();
    Ok(r)
}

/// Abre la pantalla de bienvenida en el segundo monitor (el TV por HDMI), en pantalla completa.
/// Sin segundo monitor la abre como ventana normal, para probarla. Si ya está abierta, la trae al frente.
/// Debe ser `async`: en Windows, crear una ventana desde un comando síncrono bloquea toda la app (wry#583).
#[tauri::command]
pub async fn abrir_pantalla_bienvenida(app: tauri::AppHandle) -> Resultado<String> {
    if let Some(v) = app.get_webview_window("bienvenida") {
        let _ = v.set_focus();
        return Ok("ya_abierta".into());
    }
    let principal = app.primary_monitor().ok().flatten().map(|m| *m.position());
    let tv = app.available_monitors().unwrap_or_default().into_iter().find(|m| Some(*m.position()) != principal);
    let mut b = tauri::WebviewWindowBuilder::new(&app, "bienvenida", tauri::WebviewUrl::App("index.html".into()))
        .title("GymDesk · Bienvenida")
        .inner_size(1280.0, 720.0);
    if let Some(m) = &tv {
        let p = m.position();
        let escala = m.scale_factor();
        b = b.position(p.x as f64 / escala + 40.0, p.y as f64 / escala + 40.0);
    }
    let ventana = b
        .build()
        .map_err(|e| ErrorApp::nuevo("PANTALLA_NO_ABRIO", &format!("No se pudo abrir la pantalla de bienvenida: {e}")))?;
    if tv.is_some() {
        let _ = ventana.set_fullscreen(true);
        Ok("en_tv".into())
    } else {
        Ok("sin_segundo_monitor".into())
    }
}

#[derive(serde::Serialize)]
pub struct EstadoPuerta {
    pub config: crate::puerta::ConfigPuerta,
    pub tipos: Vec<(String, String)>,
    pub puede_configurar: bool,
}

#[tauri::command]
pub fn puerta_estado(estado: State<'_, EstadoApp>) -> Resultado<EstadoPuerta> {
    estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        Ok(EstadoPuerta {
            config: crate::puerta::leer(conn)?,
            tipos: crate::puerta::TIPOS.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(),
            puede_configurar: usuario.rol == "jefe",
        })
    })
}

#[tauri::command]
pub fn puerta_configurar(estado: State<'_, EstadoApp>, config: crate::puerta::ConfigPuerta) -> Resultado<crate::puerta::ConfigPuerta> {
    let cfg = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        crate::puerta::configurar(conn, ahora, &usuario, &config)
    })?;
    estado.despertar();
    Ok(cfg)
}

/// Abre la puerta a mano (botón de Ingreso o "Probar apertura"). Queda en la auditoría de la estación.
#[tauri::command]
pub async fn puerta_abrir(estado: State<'_, EstadoApp>, motivo: Option<String>) -> Resultado<()> {
    let cfg = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        let cfg = crate::puerta::leer(conn)?;
        let motivo: String = motivo.as_deref().unwrap_or("manual").chars().take(60).collect();
        crate::auditoria::registrar(conn, ahora, crate::auditoria::Actor::persona(&usuario.id, &usuario.nombre), "ABRIR_PUERTA_MANUAL", "estacion", None,
            &serde_json::json!({ "motivo": motivo }))?;
        Ok(cfg)
    })?;
    tauri::async_runtime::spawn_blocking(move || crate::puerta::abrir(&cfg)).await.map_err(|_| error_interno())?
}

/// Si el ingreso quedó verde y hay puerta configurada, la abre en segundo plano (no frena la pantalla).
fn abrir_puerta_si_corresponde(estado: &EstadoApp, resultado: &ResultadoIngreso) {
    if !resultado.abre || resultado.relectura_ignorada {
        return;
    }
    if let Ok(cfg) = estado.con_base(|conn, _, _| crate::puerta::leer(conn)) {
        if cfg.tipo != "ninguna" {
            std::thread::spawn(move || {
                if let Err(e) = crate::puerta::abrir(&cfg) {
                    eprintln!("[puerta] {}", e.mensaje);
                }
            });
        }
    }
}

/// Historial de mediciones de un cliente (con internet).
#[tauri::command]
pub async fn mediciones_cliente(estado: State<'_, EstadoApp>, deportista_id: String) -> Resultado<serde_json::Value> {
    let ruta = crate::sync::clientes::ruta_mediciones(&deportista_id)?;
    let (base, sesion, transporte, reloj) = (estado.base()?.clone(), estado.sesion.clone(), estado.transporte.clone(), estado.reloj.clone());
    tauri::async_runtime::spawn_blocking(move || {
        crate::sync::clientes::en_linea(&base, &sesion, transporte.as_ref(), reloj.as_ref(), crate::sync::transporte::Metodo::Get, &ruta, None)
    })
    .await
    .map_err(|_| error_interno())?
}

/// Registra una medición del cliente en el servidor (con internet), con las mismas reglas de la web.
#[tauri::command]
pub async fn registrar_medicion(estado: State<'_, EstadoApp>, deportista_id: String, medicion: serde_json::Value) -> Resultado<serde_json::Value> {
    let ruta = crate::sync::clientes::ruta_mediciones(&deportista_id)?;
    let (base, sesion, transporte, reloj) = (estado.base()?.clone(), estado.sesion.clone(), estado.transporte.clone(), estado.reloj.clone());
    tauri::async_runtime::spawn_blocking(move || {
        crate::sync::clientes::en_linea(&base, &sesion, transporte.as_ref(), reloj.as_ref(), crate::sync::transporte::Metodo::Post, &ruta, Some(medicion))
    })
    .await
    .map_err(|_| error_interno())?
}

/// Módulo Clientes: lista con búsqueda y filtro por estado.
#[tauri::command]
pub fn listar_clientes(
    estado: State<'_, EstadoApp>,
    texto: String,
    filtro: String,
    limite: usize,
    desde: usize,
) -> Resultado<crate::acceso::clientes::PaginaClientes> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        crate::acceso::clientes::listar(conn, &texto, &filtro, fecha_negocio(ahora), limite, desde)
    })
}

#[tauri::command]
pub fn ficha_cliente(estado: State<'_, EstadoApp>, deportista_id: String) -> Resultado<crate::acceso::clientes::FichaCliente> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        crate::acceso::clientes::ficha(conn, &deportista_id, fecha_negocio(ahora))
    })
}

// ---------------------------------------------------------------------------
// Huella (fase 4). Capturar bloquea hasta que llega el dedo: corre fuera del hilo de la ventana.
// ---------------------------------------------------------------------------
#[derive(Serialize)]
pub struct EstadoHuella {
    pub lector: String,
    pub lectores: Vec<(String, String)>,
    pub puede_configurar: bool,
    pub puede_registrar: bool,
    pub muestras_registro: usize,
    pub dedos: Vec<String>,
}

#[tauri::command]
pub fn huella_estado(estado: State<'_, EstadoApp>) -> Resultado<EstadoHuella> {
    estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        Ok(EstadoHuella {
            lector: crate::huella::lector_configurado(conn)?,
            lectores: crate::huella::LECTORES.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(),
            puede_configurar: usuario.rol == "jefe",
            puede_registrar: crate::sync::clientes::puede_registrar(conn, &usuario)?,
            muestras_registro: crate::huella::MUESTRAS_REGISTRO,
            dedos: crate::huella::DEDOS.iter().map(|d| d.to_string()).collect(),
        })
    })
}

#[tauri::command]
pub fn huella_configurar(estado: State<'_, EstadoApp>, lector: String) -> Resultado<()> {
    estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        crate::huella::configurar(conn, ahora, &usuario, &lector)
    })?;
    estado.despertar();
    Ok(())
}

fn lector_de_sesion(estado: &EstadoApp) -> Resultado<String> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        exigir_operable(conn, ahora)?;
        crate::huella::lector_configurado(conn)
    })
}

/// Una lectura para el registro de una huella. Devuelve la muestra en base64.
#[tauri::command]
pub async fn huella_capturar(estado: State<'_, EstadoApp>, simulada: Option<String>) -> Resultado<String> {
    let nombre = lector_de_sesion(&estado)?;
    let muestra = tauri::async_runtime::spawn_blocking(move || crate::huella::crear(&nombre)?.capturar(15_000, simulada.as_deref()))
        .await
        .map_err(|_| error_interno())??;
    Ok(crate::huella::a_base64(&muestra))
}

/// Une las lecturas en una plantilla, la guarda en la estación y la encola para el servidor.
#[tauri::command]
pub async fn huella_registrar(
    estado: State<'_, EstadoApp>,
    deportista_id: String,
    dedo: String,
    muestras: Vec<String>,
) -> Resultado<crate::huella::HuellaRegistrada> {
    let nombre = lector_de_sesion(&estado)?;
    let decodificadas = muestras.iter().map(|m| crate::huella::de_base64(m)).collect::<Resultado<Vec<_>>>()?;
    let (formato, plantilla) = tauri::async_runtime::spawn_blocking(move || {
        let lector = crate::huella::crear(&nombre)?;
        Ok::<_, ErrorApp>((lector.formato(), lector.plantilla(&decodificadas)?))
    })
    .await
    .map_err(|_| error_interno())??;
    let r = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        crate::huella::guardar(conn, ahora, &usuario, &deportista_id, &dedo, formato, &plantilla)
    })?;
    estado.despertar();
    Ok(r)
}

#[tauri::command]
pub fn huella_dedos(estado: State<'_, EstadoApp>, deportista_id: String) -> Resultado<Vec<String>> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        crate::huella::dedos_de(conn, &deportista_id)
    })
}

/// Ingreso con huella: lee el dedo, lo busca entre las huellas de la estación y registra el ingreso.
#[tauri::command]
pub async fn ingreso_por_huella(app: tauri::AppHandle, estado: State<'_, EstadoApp>, simulada: Option<String>) -> Resultado<ResultadoIngreso> {
    let nombre = lector_de_sesion(&estado)?;
    let base = estado.base()?.clone();
    let encontrado = tauri::async_runtime::spawn_blocking(move || {
        let lector = crate::huella::crear(&nombre)?;
        let muestra = lector.capturar(15_000, simulada.as_deref())?;
        // La base se toma solo para leer las plantillas, no mientras se espera el dedo.
        let guardadas = {
            let conn = base.lock().map_err(|_| error_interno())?;
            crate::huella::plantillas(&conn, lector.formato())?
        };
        let solo: Vec<Vec<u8>> = guardadas.iter().map(|(_, p)| p.clone()).collect();
        Ok::<_, ErrorApp>(lector.identificar(&muestra, &solo)?.map(|i| guardadas[i].0.clone()))
    })
    .await
    .map_err(|_| error_interno())??;
    let Some(deportista_id) = encontrado else {
        return Err(ErrorApp::nuevo("HUELLA_NO_RECONOCIDA", "No se reconoce la huella. Búscalo por documento o registra su huella."));
    };
    let resultado = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        exigir_operable(conn, ahora)?;
        registro::registrar_ingreso(conn, ahora, &usuario, Objetivo::Id(&deportista_id), "huella")
    })?;
    abrir_puerta_si_corresponde(&estado, &resultado);
    if !resultado.relectura_ignorada {
        estado.despertar();
        let _ = app.emit("ingreso-registrado", &resultado);
    }
    Ok(resultado)
}

/// ¿La persona con sesión puede registrar clientes? (permiso de crear deportistas)
#[tauri::command]
pub fn puede_registrar_clientes(estado: State<'_, EstadoApp>) -> Resultado<bool> {
    estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        crate::sync::clientes::puede_registrar(conn, &usuario)
    })
}

/// Qué se le puede cobrar a un cliente: renovar su membresía o venderle un plan (fase 3B).
#[tauri::command]
pub fn caja_opciones_membresia(estado: State<'_, EstadoApp>, deportista_id: String) -> Resultado<caja::membresias::OpcionesMembresia> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        caja::membresias::opciones(conn, &deportista_id, fecha_negocio(ahora))
    })
}

#[tauri::command]
pub fn caja_cobrar_membresia(
    estado: State<'_, EstadoApp>,
    cobro: caja::membresias::NuevoCobroMembresia,
) -> Resultado<caja::membresias::CobroMembresiaRegistrado> {
    let registrado = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        exigir_operable(conn, ahora)?;
        caja::membresias::cobrar(conn, ahora, &usuario, &cobro)
    })?;
    estado.despertar();
    Ok(registrado)
}

#[tauri::command]
pub fn caja_registrar_venta(estado: State<'_, EstadoApp>, venta: caja::NuevaVenta) -> Resultado<caja::VentaRegistrada> {
    let registrada = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        exigir_operable(conn, ahora)?;
        caja::registrar_venta(conn, ahora, &usuario, &venta)
    })?;
    estado.despertar();
    Ok(registrada)
}

#[tauri::command]
pub fn caja_registrar_egreso(estado: State<'_, EstadoApp>, monto: i64, motivo: String) -> Resultado<caja::EgresoRegistrado> {
    let egreso = estado.con_base(|conn, sesion, ahora| {
        let usuario = sesion.exigir_activa(conn, ahora)?;
        exigir_operable(conn, ahora)?;
        caja::registrar_egreso(conn, ahora, &usuario, monto, &motivo)
    })?;
    estado.despertar();
    Ok(egreso)
}

/// Movimientos de un turno de esta estación (el abierto si no se indica).
#[tauri::command]
pub fn caja_movimientos(estado: State<'_, EstadoApp>, turno_id: Option<String>) -> Resultado<Vec<caja::Movimiento>> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        let id = match turno_id {
            Some(id) => id,
            None => match caja::turno_abierto(conn)? {
                Some(t) => t.id,
                None => return Ok(vec![]),
            },
        };
        caja::movimientos(conn, &id)
    })
}

/// Cierre diario de esta estación (A3). Sin fecha, el de hoy (día de Bogotá).
#[tauri::command]
pub fn caja_cierre_diario(estado: State<'_, EstadoApp>, fecha: Option<String>) -> Resultado<caja::CierreDiario> {
    estado.con_base(|conn, sesion, ahora| {
        sesion.exigir_activa(conn, ahora)?;
        let dia = match fecha.as_deref() {
            Some(f) => f.parse().map_err(|_| ErrorApp::nuevo("FECHA_INVALIDA", "La fecha debe tener la forma AAAA-MM-DD."))?,
            None => fecha_negocio(ahora),
        };
        caja::cierre_diario(conn, dia)
    })
}
