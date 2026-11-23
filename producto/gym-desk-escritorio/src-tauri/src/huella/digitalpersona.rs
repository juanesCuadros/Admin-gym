//! Lector DigitalPersona U.are.U (4000B, 4500, 5100, 5160, 5300) con el kit oficial de HID:
//! `dpfpdd.dll` (captura) y `dpfj.dll` (extracción y comparación). Las instala el "U.are.U Runtime" o el SDK.
//!
//! Las DLL se cargan al usar el lector (libloading): la app compila y abre sin el kit. Las plantillas son
//! ANSI 378-2004 (formato estándar, sirve con otras marcas que lo soporten). La coincidencia usa la tasa de
//! falsa aceptación recomendada por el fabricante: 1 en 100.000.
//!
//! **Sin probar con el aparato** (22-nov-2026): las firmas siguen los encabezados públicos `dpfpdd.h` y
//! `dpfj.h` del SDK. La primera prueba es con el 4000B del gimnasio.

use std::ffi::{c_char, c_int, c_uint, CStr};
use std::ptr;

use libloading::{Library, Symbol};

use super::LectorHuella;
use crate::error::{ErrorApp, Resultado};

const FACILIDAD: c_int = 0x05BA << 16;
const E_MORE_DATA: c_int = FACILIDAD | 0x0d;
const EXITO: c_int = 0;

const IMG_FMT_ANSI381: c_uint = 0x001B_0401;
const IMG_PROC_DEFAULT: c_uint = 0;
const FID_ANSI_381_2004: c_uint = 0x001B_0401;
const FMD_ANSI_378_2004: c_uint = 0x001B_0001;
const MAX_FMD: usize = 1562;
const MAX_IMAGEN: usize = 1_000_000;
const PROBABILIDAD_UNO: c_uint = 0x7FFF_FFFF;
/// Falsa aceptación 1 en 100.000 (la que recomienda DigitalPersona para control de acceso).
const UMBRAL: c_uint = PROBABILIDAD_UNO / 100_000;

#[repr(C)]
struct VerInfo {
    major: c_int,
    minor: c_int,
    maintenance: c_int,
}
#[repr(C)]
struct HwDescr {
    vendor_name: [c_char; 128],
    product_name: [c_char; 128],
    serial_num: [c_char; 128],
}
#[repr(C)]
struct HwId {
    vendor_id: u16,
    product_id: u16,
}
#[repr(C)]
struct HwVersion {
    hw_ver: VerInfo,
    fw_ver: VerInfo,
    bcd_rev: u16,
}
#[repr(C)]
struct DevInfo {
    size: c_uint,
    name: [c_char; 1024],
    descr: HwDescr,
    id: HwId,
    ver: HwVersion,
    modality: c_uint,
    technology: c_uint,
}
#[repr(C)]
struct CaptureParam {
    size: c_uint,
    image_fmt: c_uint,
    image_proc: c_uint,
    image_res: c_uint,
}
#[repr(C)]
#[derive(Default)]
struct ImageInfo {
    size: c_uint,
    width: c_uint,
    height: c_uint,
    res: c_uint,
    bpp: c_uint,
}
#[repr(C)]
#[derive(Default)]
struct CaptureResult {
    size: c_uint,
    success: c_int,
    quality: c_uint,
    score: c_uint,
    info: ImageInfo,
}
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Candidato {
    fmd_idx: c_uint,
    view_idx: c_uint,
}

type Dev = *mut std::ffi::c_void;

pub struct DigitalPersona {
    dd: Library,
    fj: Library,
}

fn error(codigo: &str, mensaje: &str) -> ErrorApp {
    ErrorApp::nuevo(codigo, mensaje)
}

fn fallo(funcion: &str, r: c_int) -> ErrorApp {
    eprintln!("[huella] {funcion} devolvió 0x{r:08X}");
    ErrorApp::con_detalles(
        "LECTOR_HUELLA_ERROR",
        "El lector de huella no respondió. Revisa que esté conectado y vuelve a intentar.",
        serde_json::json!({ "funcion": funcion, "codigo": format!("0x{r:08X}") }),
    )
}

impl DigitalPersona {
    pub fn cargar() -> Resultado<Self> {
        // SAFETY: son las DLL del fabricante; se cargan por nombre desde el sistema.
        let dd = unsafe { Library::new("dpfpdd.dll") };
        let fj = unsafe { Library::new("dpfj.dll") };
        match (dd, fj) {
            (Ok(dd), Ok(fj)) => Ok(Self { dd, fj }),
            _ => Err(error(
                "KIT_HUELLA_NO_INSTALADO",
                "No se encontró el controlador de DigitalPersona en este equipo. Instala el \"U.are.U Runtime\" de HID y vuelve a intentar.",
            )),
        }
    }

    fn simbolo<'a, T>(lib: &'a Library, nombre: &[u8]) -> Resultado<Symbol<'a, T>> {
        // SAFETY: el tipo T corresponde a la firma publicada en dpfpdd.h / dpfj.h.
        unsafe { lib.get(nombre) }.map_err(|_| {
            error("KIT_HUELLA_INCOMPATIBLE", "La versión instalada del controlador de DigitalPersona no es compatible. Instala el U.are.U Runtime 3.")
        })
    }

    /// Abre el primer lector conectado, ejecuta `f` y lo cierra.
    fn con_lector<R>(&self, f: impl FnOnce(Dev, c_uint) -> Resultado<R>) -> Resultado<R> {
        type Init = unsafe extern "C" fn() -> c_int;
        type Query = unsafe extern "C" fn(*mut c_uint, *mut DevInfo) -> c_int;
        type Open = unsafe extern "C" fn(*mut c_char, *mut Dev) -> c_int;
        type Close = unsafe extern "C" fn(Dev) -> c_int;
        type Caps = unsafe extern "C" fn(Dev, *mut c_uint) -> c_int;
        let init: Symbol<Init> = Self::simbolo(&self.dd, b"dpfpdd_init\0")?;
        let exit: Symbol<Init> = Self::simbolo(&self.dd, b"dpfpdd_exit\0")?;
        let query: Symbol<Query> = Self::simbolo(&self.dd, b"dpfpdd_query_devices\0")?;
        let open: Symbol<Open> = Self::simbolo(&self.dd, b"dpfpdd_open\0")?;
        let close: Symbol<Close> = Self::simbolo(&self.dd, b"dpfpdd_close\0")?;
        let caps: Symbol<Caps> = Self::simbolo(&self.dd, b"dpfpdd_get_device_capabilities\0")?;

        // SAFETY: llamadas al kit con estructuras #[repr(C)] del tamaño que declaran en `size`.
        unsafe {
            let r = init();
            if r != EXITO {
                return Err(fallo("dpfpdd_init", r));
            }
            let resultado = (|| {
                let mut infos: Vec<DevInfo> = (0..4).map(|_| std::mem::zeroed()).collect();
                for i in infos.iter_mut() {
                    i.size = std::mem::size_of::<DevInfo>() as c_uint;
                }
                let mut cuantos: c_uint = infos.len() as c_uint;
                let r = query(&mut cuantos, infos.as_mut_ptr());
                if r != EXITO && r != E_MORE_DATA {
                    return Err(fallo("dpfpdd_query_devices", r));
                }
                if cuantos == 0 {
                    return Err(error("LECTOR_NO_CONECTADO", "No hay un lector de huella conectado. Conéctalo por USB y vuelve a intentar."));
                }
                let nombre = CStr::from_ptr(infos[0].name.as_ptr()).to_owned();
                let mut dev: Dev = ptr::null_mut();
                let r = open(nombre.as_ptr() as *mut c_char, &mut dev);
                if r != EXITO {
                    return Err(fallo("dpfpdd_open", r));
                }
                // Resolución: la primera que declare el lector (el 4000B trabaja a 512 dpi).
                let mut c = [0 as c_uint; 256];
                c[0] = (c.len() * 4) as c_uint;
                let resolucion = if caps(dev, c.as_mut_ptr()) == EXITO && c[11] > 0 { c[12] } else { 500 };
                let r = f(dev, resolucion);
                close(dev);
                r
            })();
            exit();
            resultado
        }
    }

    fn fmd_de_fid(&self, fid: &[u8]) -> Resultado<Vec<u8>> {
        type Crear = unsafe extern "C" fn(c_uint, *const u8, c_uint, c_uint, *mut u8, *mut c_uint) -> c_int;
        let crear: Symbol<Crear> = Self::simbolo(&self.fj, b"dpfj_create_fmd_from_fid\0")?;
        let mut fmd = vec![0u8; MAX_FMD];
        let mut tam = MAX_FMD as c_uint;
        // SAFETY: búferes con el tamaño declarado.
        let r = unsafe { crear(FID_ANSI_381_2004, fid.as_ptr(), fid.len() as c_uint, FMD_ANSI_378_2004, fmd.as_mut_ptr(), &mut tam) };
        if r != EXITO {
            return Err(error("HUELLA_NO_LEIDA", "No se pudo leer bien la huella. Limpia el lector y pon el dedo de nuevo, plano y quieto."));
        }
        fmd.truncate(tam as usize);
        Ok(fmd)
    }
}

impl LectorHuella for DigitalPersona {
    fn formato(&self) -> &'static str {
        "ansi378"
    }

    fn capturar(&self, espera_ms: u32, _simulada: Option<&str>) -> Resultado<Vec<u8>> {
        type Capture = unsafe extern "C" fn(Dev, *mut CaptureParam, c_uint, *mut CaptureResult, *mut c_uint, *mut u8) -> c_int;
        let capture: Symbol<Capture> = Self::simbolo(&self.dd, b"dpfpdd_capture\0")?;
        let fid = self.con_lector(|dev, resolucion| {
            let mut param = CaptureParam {
                size: std::mem::size_of::<CaptureParam>() as c_uint,
                image_fmt: IMG_FMT_ANSI381,
                image_proc: IMG_PROC_DEFAULT,
                image_res: resolucion,
            };
            let mut res = CaptureResult { size: std::mem::size_of::<CaptureResult>() as c_uint, ..Default::default() };
            res.info.size = std::mem::size_of::<ImageInfo>() as c_uint;
            let mut imagen = vec![0u8; MAX_IMAGEN];
            let mut tam = MAX_IMAGEN as c_uint;
            // SAFETY: búfer de imagen con el tamaño declarado; bloquea hasta el dedo o el tiempo de espera.
            let r = unsafe { capture(dev, &mut param, espera_ms, &mut res, &mut tam, imagen.as_mut_ptr()) };
            if r != EXITO {
                return Err(fallo("dpfpdd_capture", r));
            }
            if res.success == 0 {
                return Err(error("HUELLA_NO_LEIDA", "No se detectó el dedo a tiempo. Pon el dedo en el lector y vuelve a intentar."));
            }
            if res.quality != 0 {
                return Err(error("HUELLA_NO_LEIDA", "La lectura salió borrosa. Pon el dedo plano y quieto, sin presionar de más."));
            }
            imagen.truncate(tam as usize);
            Ok(imagen)
        })?;
        self.fmd_de_fid(&fid)
    }

    fn plantilla(&self, muestras: &[Vec<u8>]) -> Resultado<Vec<u8>> {
        type Start = unsafe extern "C" fn(c_uint) -> c_int;
        type Add = unsafe extern "C" fn(c_uint, *const u8, c_uint, c_uint) -> c_int;
        type Create = unsafe extern "C" fn(*mut u8, *mut c_uint) -> c_int;
        type Finish = unsafe extern "C" fn() -> c_int;
        let start: Symbol<Start> = Self::simbolo(&self.fj, b"dpfj_start_enrollment\0")?;
        let add: Symbol<Add> = Self::simbolo(&self.fj, b"dpfj_add_to_enrollment\0")?;
        let create: Symbol<Create> = Self::simbolo(&self.fj, b"dpfj_create_enrollment_fmd\0")?;
        let finish: Symbol<Finish> = Self::simbolo(&self.fj, b"dpfj_finish_enrollment\0")?;
        // SAFETY: secuencia de registro del kit; cada FMD con su tamaño.
        unsafe {
            let r = start(FMD_ANSI_378_2004);
            if r != EXITO {
                return Err(fallo("dpfj_start_enrollment", r));
            }
            let mut listo = false;
            for m in muestras {
                let r = add(FMD_ANSI_378_2004, m.as_ptr(), m.len() as c_uint, 0);
                if r == EXITO {
                    listo = true;
                    break;
                }
                if r != E_MORE_DATA {
                    finish();
                    return Err(error("HUELLAS_DISTINTAS", "Las lecturas no coinciden entre sí. Usa siempre el mismo dedo y empieza de nuevo."));
                }
            }
            if !listo {
                finish();
                return Err(error("FALTAN_MUESTRAS", "Hacen falta más lecturas del mismo dedo. Empieza de nuevo."));
            }
            let mut fmd = vec![0u8; MAX_FMD * 4];
            let mut tam = fmd.len() as c_uint;
            let r = create(fmd.as_mut_ptr(), &mut tam);
            finish();
            if r != EXITO {
                return Err(fallo("dpfj_create_enrollment_fmd", r));
            }
            fmd.truncate(tam as usize);
            Ok(fmd)
        }
    }

    fn identificar(&self, muestra: &[u8], plantillas: &[Vec<u8>]) -> Resultado<Option<usize>> {
        if plantillas.is_empty() {
            return Ok(None);
        }
        type Identify = unsafe extern "C" fn(
            c_uint, *const u8, c_uint, c_uint, c_uint, c_uint, *const *const u8, *const c_uint, c_uint, *mut c_uint, *mut Candidato,
        ) -> c_int;
        let identify: Symbol<Identify> = Self::simbolo(&self.fj, b"dpfj_identify\0")?;
        let punteros: Vec<*const u8> = plantillas.iter().map(|p| p.as_ptr()).collect();
        let tamanos: Vec<c_uint> = plantillas.iter().map(|p| p.len() as c_uint).collect();
        let mut candidatos = [Candidato::default(); 1];
        let mut cuantos: c_uint = 1;
        // SAFETY: arreglos paralelos de punteros y tamaños que viven durante la llamada.
        let r = unsafe {
            identify(
                FMD_ANSI_378_2004, muestra.as_ptr(), muestra.len() as c_uint, 0,
                FMD_ANSI_378_2004, plantillas.len() as c_uint, punteros.as_ptr(), tamanos.as_ptr(),
                UMBRAL, &mut cuantos, candidatos.as_mut_ptr(),
            )
        };
        if r != EXITO {
            return Err(fallo("dpfj_identify", r));
        }
        Ok((cuantos > 0).then(|| candidatos[0].fmd_idx as usize))
    }
}
