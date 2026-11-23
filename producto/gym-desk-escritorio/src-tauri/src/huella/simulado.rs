//! Lector simulado: la "huella" es un texto que escribe quien prueba. Sirve para recorrer el flujo completo
//! (registrar la huella de un cliente y entrar con ella) sin el aparato. Dos muestras coinciden si el texto es igual.

use super::LectorHuella;
use crate::error::{ErrorApp, Resultado};

pub struct Simulado;

impl LectorHuella for Simulado {
    fn formato(&self) -> &'static str {
        "simulado"
    }

    fn capturar(&self, _espera_ms: u32, simulada: Option<&str>) -> Resultado<Vec<u8>> {
        let texto = simulada.map(str::trim).filter(|t| !t.is_empty()).ok_or_else(|| {
            ErrorApp::nuevo("HUELLA_NO_LEIDA", "Lector simulado: escribe un código que represente el dedo (por ejemplo, pedro-indice).")
        })?;
        Ok(format!("SIM:{}", texto.to_lowercase()).into_bytes())
    }

    fn plantilla(&self, muestras: &[Vec<u8>]) -> Resultado<Vec<u8>> {
        let primera = muestras.first().ok_or_else(|| ErrorApp::nuevo("HUELLA_NO_LEIDA", "No hay muestras."))?;
        if muestras.iter().any(|m| m != primera) {
            return Err(ErrorApp::nuevo("HUELLAS_DISTINTAS", "Las muestras no son del mismo dedo. Empieza de nuevo."));
        }
        Ok(primera.clone())
    }

    fn identificar(&self, muestra: &[u8], plantillas: &[Vec<u8>]) -> Resultado<Option<usize>> {
        Ok(plantillas.iter().position(|p| p == muestra))
    }
}
