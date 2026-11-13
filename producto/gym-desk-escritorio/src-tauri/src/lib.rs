//! GymDesk Escritorio: estación de recepción que funciona sin internet.

pub mod auditoria;
pub mod comandos;
pub mod db;
pub mod error;
pub mod reloj;
pub mod sesion;
pub mod sync;

use tauri::Manager;

use comandos::EstadoApp;
use reloj::{Reloj, RelojSistema};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let reloj = RelojSistema;
            // Si la carpeta o la base fallan, la app abre igual y muestra el motivo.
            let base = app
                .path()
                .app_data_dir()
                .map_err(|e| {
                    eprintln!("[arranque] carpeta de datos: {e}");
                    error::ErrorApp::nuevo("ERROR_ARCHIVOS", "No se encontró la carpeta de datos de GymDesk en este equipo.")
                })
                .and_then(|dir| db::preparar(&dir, &db::clave::ProtectorDpapi, reloj.ahora()));
            app.manage(EstadoApp::nuevo(base, Box::new(reloj)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            comandos::estado_estacion,
            comandos::estado_sesion,
            comandos::registrar_actividad,
            comandos::personal_con_pin,
            comandos::iniciar_sesion_password,
            comandos::iniciar_sesion_pin,
            comandos::desbloquear_sesion,
            comandos::bloquear_sesion,
            comandos::cerrar_sesion,
            comandos::definir_pin,
        ])
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar GymDesk");
}
