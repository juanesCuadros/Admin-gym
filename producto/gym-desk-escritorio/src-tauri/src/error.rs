//! Error único de la app, con la misma forma que usa la API del gimnasio:
//! `{"codigo": "MAYUSCULAS", "mensaje": "...", "detalles"?: {...}}`.

use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ErrorApp {
    pub codigo: String,
    pub mensaje: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detalles: Option<Value>,
}

impl ErrorApp {
    pub fn nuevo(codigo: &str, mensaje: &str) -> Self {
        Self { codigo: codigo.to_string(), mensaje: mensaje.to_string(), detalles: None }
    }

    pub fn con_detalles(codigo: &str, mensaje: &str, detalles: Value) -> Self {
        Self { codigo: codigo.to_string(), mensaje: mensaje.to_string(), detalles: Some(detalles) }
    }
}

impl std::fmt::Display for ErrorApp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.codigo, self.mensaje)
    }
}

impl std::error::Error for ErrorApp {}

impl From<rusqlite::Error> for ErrorApp {
    fn from(e: rusqlite::Error) -> Self {
        // El detalle técnico va al registro, no a la pantalla.
        eprintln!("[base local] {e}");
        ErrorApp::nuevo("ERROR_BASE_LOCAL", "No se pudo leer o guardar en la base local de esta estación.")
    }
}

impl From<std::io::Error> for ErrorApp {
    fn from(e: std::io::Error) -> Self {
        eprintln!("[archivos] {e}");
        ErrorApp::nuevo("ERROR_ARCHIVOS", "No se pudo leer o escribir en la carpeta de datos de GymDesk.")
    }
}

pub type Resultado<T> = Result<T, ErrorApp>;
