//! Verificadores de contraseña y PIN con Argon2id (GW-RNF-01).

use std::sync::OnceLock;

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;

use crate::error::{ErrorApp, Resultado};

pub const DIGITOS_PIN: usize = 4;

pub fn generar_hash(secreto: &str) -> Resultado<String> {
    let sal = SaltString::generate(&mut OsRng);
    Argon2::default().hash_password(secreto.as_bytes(), &sal).map(|h| h.to_string()).map_err(|e| {
        eprintln!("[credenciales] {e}");
        ErrorApp::nuevo("ERROR_CREDENCIALES", "No se pudo guardar la credencial. Intenta de nuevo.")
    })
}

pub fn verificar(secreto: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(h) => Argon2::default().verify_password(secreto.as_bytes(), &h).is_ok(),
        Err(_) => false,
    }
}

/// Gasta el mismo tiempo que una verificación real cuando la persona no existe,
/// para que el tiempo de respuesta no revele qué correos están registrados.
pub fn verificar_en_vacio(secreto: &str) {
    static HASH: OnceLock<String> = OnceLock::new();
    let hash = HASH.get_or_init(|| generar_hash("sin-usuario").unwrap_or_default());
    let _ = verificar(secreto, hash);
}

pub fn validar_formato_pin(pin: &str) -> Resultado<()> {
    if pin.len() == DIGITOS_PIN && pin.chars().all(|c| c.is_ascii_digit()) {
        Ok(())
    } else {
        Err(ErrorApp::nuevo("PIN_INVALIDO", "El PIN debe tener exactamente 4 números."))
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn el_hash_es_argon2id_y_verifica_solo_el_secreto_correcto() {
        let hash = generar_hash("Recepcion2026*").unwrap();
        assert!(hash.starts_with("$argon2id$"));
        assert!(verificar("Recepcion2026*", &hash));
        assert!(!verificar("recepcion2026*", &hash));
        assert!(!verificar("", &hash));
    }

    #[test]
    fn un_hash_danado_nunca_verifica() {
        assert!(!verificar("lo-que-sea", "no-es-un-hash"));
        assert!(!verificar("lo-que-sea", ""));
    }

    #[test]
    fn el_pin_son_exactamente_cuatro_numeros() {
        assert!(validar_formato_pin("0412").is_ok());
        for malo in ["", "123", "12345", "12a4", "12 4", "١٢٣٤"] {
            assert_eq!(validar_formato_pin(malo).unwrap_err().codigo, "PIN_INVALIDO", "{malo}");
        }
    }
}
