//! Clave de cifrado de la base local.
//!
//! Son 256 bits aleatorios generados en el primer arranque. En disco solo queda
//! protegida con DPAPI de Windows (ligada a la cuenta de Windows del equipo):
//! quien se lleve el disco no puede abrir la base.

use std::fs;
use std::path::Path;

use rand::RngCore;
use zeroize::Zeroizing;

use crate::error::{ErrorApp, Resultado};

pub const LARGO_CLAVE: usize = 32;
pub const NOMBRE_ARCHIVO_CLAVE: &str = "clave.bin";

pub struct ClaveBase(Zeroizing<[u8; LARGO_CLAVE]>);

impl ClaveBase {
    pub fn desde_bytes(bytes: [u8; LARGO_CLAVE]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    /// Clave en hexadecimal, para `PRAGMA key`.
    pub fn hex(&self) -> Zeroizing<String> {
        let mut s = String::with_capacity(LARGO_CLAVE * 2);
        for b in self.0.iter() {
            s.push_str(&format!("{b:02x}"));
        }
        Zeroizing::new(s)
    }
}

/// Protege y recupera la clave para guardarla en disco.
pub trait ProtectorClave {
    fn proteger(&self, datos: &[u8]) -> Resultado<Vec<u8>>;
    fn desproteger(&self, datos: &[u8]) -> Resultado<Vec<u8>>;
}

/// Devuelve la clave guardada o crea una nueva si la estación es nueva.
///
/// Si ya existe una base pero falta su clave, **no** se crea otra: la base
/// quedaría ilegible y se perdería lo que estuviera pendiente de sincronizar.
pub fn obtener_o_crear(dir: &Path, protector: &dyn ProtectorClave, existe_base: bool) -> Resultado<ClaveBase> {
    let ruta = dir.join(NOMBRE_ARCHIVO_CLAVE);

    if ruta.exists() {
        let protegida = fs::read(&ruta)?;
        let clara = Zeroizing::new(protector.desproteger(&protegida)?);
        let bytes: [u8; LARGO_CLAVE] = clara.as_slice().try_into().map_err(|_| clave_ilegible())?;
        return Ok(ClaveBase::desde_bytes(bytes));
    }

    if existe_base {
        return Err(ErrorApp::nuevo(
            "CLAVE_BASE_NO_ENCONTRADA",
            "Esta estación tiene datos guardados pero falta su clave de cifrado. No se creó una base nueva para no perder información. Contacta a soporte.",
        ));
    }

    let mut bytes = [0u8; LARGO_CLAVE];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    let protegida = protector.proteger(&bytes)?;
    fs::write(&ruta, protegida)?;
    Ok(ClaveBase::desde_bytes(bytes))
}

fn clave_ilegible() -> ErrorApp {
    ErrorApp::nuevo(
        "CLAVE_BASE_ILEGIBLE",
        "No se pudo leer la clave de cifrado de esta estación. Si cambiaste de usuario de Windows, entra con el usuario con el que se instaló GymDesk.",
    )
}

/// Protección con DPAPI de Windows (`CryptProtectData`), sin diálogos.
#[cfg(windows)]
pub struct ProtectorDpapi;

#[cfg(windows)]
impl ProtectorClave for ProtectorDpapi {
    fn proteger(&self, datos: &[u8]) -> Resultado<Vec<u8>> {
        dpapi::transformar(datos, true).map_err(|e| {
            eprintln!("[dpapi] proteger: {e}");
            ErrorApp::nuevo("CLAVE_BASE_NO_SE_PUDO_GUARDAR", "Windows no permitió proteger la clave de cifrado de esta estación.")
        })
    }

    fn desproteger(&self, datos: &[u8]) -> Resultado<Vec<u8>> {
        dpapi::transformar(datos, false).map_err(|e| {
            eprintln!("[dpapi] desproteger: {e}");
            clave_ilegible()
        })
    }
}

#[cfg(windows)]
mod dpapi {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    pub fn transformar(datos: &[u8], proteger: bool) -> windows::core::Result<Vec<u8>> {
        let entrada = CRYPT_INTEGER_BLOB { cbData: datos.len() as u32, pbData: datos.as_ptr() as *mut u8 };
        let mut salida = CRYPT_INTEGER_BLOB::default();
        // SAFETY: `entrada` apunta a `datos`, que vive durante la llamada; `salida` la
        // reserva Windows y se libera con LocalFree después de copiarla.
        unsafe {
            if proteger {
                CryptProtectData(&entrada, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut salida)?;
            } else {
                CryptUnprotectData(&entrada, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut salida)?;
            }
            let copia = std::slice::from_raw_parts(salida.pbData, salida.cbData as usize).to_vec();
            let _ = LocalFree(Some(HLOCAL(salida.pbData as *mut core::ffi::c_void)));
            Ok(copia)
        }
    }
}

#[cfg(test)]
pub mod pruebas {
    use super::*;

    /// Protector de pruebas: invierte los bytes. Permite probar el flujo sin DPAPI.
    pub struct ProtectorDePrueba;

    impl ProtectorClave for ProtectorDePrueba {
        fn proteger(&self, datos: &[u8]) -> Resultado<Vec<u8>> {
            Ok(datos.iter().rev().copied().collect())
        }
        fn desproteger(&self, datos: &[u8]) -> Resultado<Vec<u8>> {
            Ok(datos.iter().rev().copied().collect())
        }
    }

    #[test]
    fn la_clave_se_crea_una_vez_y_se_recupera_en_el_siguiente_arranque() {
        let dir = tempfile::tempdir().unwrap();
        let primera = obtener_o_crear(dir.path(), &ProtectorDePrueba, false).unwrap();
        let segunda = obtener_o_crear(dir.path(), &ProtectorDePrueba, true).unwrap();
        assert_eq!(*primera.hex(), *segunda.hex());
        assert_eq!(primera.hex().len(), 64);
    }

    #[test]
    fn dos_estaciones_nuevas_no_comparten_clave() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let ca = obtener_o_crear(a.path(), &ProtectorDePrueba, false).unwrap();
        let cb = obtener_o_crear(b.path(), &ProtectorDePrueba, false).unwrap();
        assert_ne!(*ca.hex(), *cb.hex());
    }

    #[test]
    fn si_hay_base_pero_falta_la_clave_no_se_crea_una_nueva() {
        let dir = tempfile::tempdir().unwrap();
        let err = obtener_o_crear(dir.path(), &ProtectorDePrueba, true).err().unwrap();
        assert_eq!(err.codigo, "CLAVE_BASE_NO_ENCONTRADA");
        assert!(!dir.path().join(NOMBRE_ARCHIVO_CLAVE).exists());
    }

    #[test]
    fn la_clave_no_queda_en_claro_en_el_disco() {
        let dir = tempfile::tempdir().unwrap();
        let clave = obtener_o_crear(dir.path(), &ProtectorDePrueba, false).unwrap();
        let en_disco = fs::read(dir.path().join(NOMBRE_ARCHIVO_CLAVE)).unwrap();
        let hex_disco: String = en_disco.iter().map(|b| format!("{b:02x}")).collect();
        assert_ne!(hex_disco, *clave.hex());
    }

    #[cfg(windows)]
    #[test]
    fn dpapi_protege_y_recupera_la_clave() {
        let dir = tempfile::tempdir().unwrap();
        let primera = obtener_o_crear(dir.path(), &ProtectorDpapi, false).unwrap();
        let en_disco = fs::read(dir.path().join(NOMBRE_ARCHIVO_CLAVE)).unwrap();
        assert!(en_disco.len() > LARGO_CLAVE, "DPAPI debe envolver la clave");
        let segunda = obtener_o_crear(dir.path(), &ProtectorDpapi, true).unwrap();
        assert_eq!(*primera.hex(), *segunda.hex());
    }

    #[cfg(windows)]
    #[test]
    fn un_archivo_de_clave_danado_se_reporta_y_no_se_reemplaza() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join(NOMBRE_ARCHIVO_CLAVE), b"basura").unwrap();
        let err = obtener_o_crear(dir.path(), &ProtectorDpapi, true).err().unwrap();
        assert_eq!(err.codigo, "CLAVE_BASE_ILEGIBLE");
        assert_eq!(fs::read(dir.path().join(NOMBRE_ARCHIVO_CLAVE)).unwrap(), b"basura");
    }
}
