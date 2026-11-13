//! Ingreso con contraseña: primero la estación, y si ella no puede confirmarla, el servidor.
//!
//! - Quien ya entró alguna vez en esta estación tiene un verificador local y entra sin red.
//! - El primer ingreso (o el siguiente a un cambio de contraseña en la web) se valida en el servidor.
//!   La estación guarda entonces su propio verificador; el hash del servidor nunca viaja.

use std::sync::Mutex;

use rusqlite::Connection;
use serde_json::json;

use crate::error::{ErrorApp, Resultado};
use crate::reloj::Reloj;
use crate::sesion::{EstadoSesion, GestorSesion, IntentoLocal, StaffConfirmado};
use crate::sync::descarga::credenciales;
use crate::sync::exigir_operable;
use crate::sync::transporte::{ErrorTransporte, Metodo, Peticion, Transporte};

fn interno() -> ErrorApp {
    ErrorApp::nuevo("ERROR_INTERNO", "GymDesk tuvo un error interno. Cierra y vuelve a abrir la aplicación.")
}

pub fn iniciar_con_password(
    base: &Mutex<Connection>,
    sesion: &Mutex<GestorSesion>,
    transporte: &dyn Transporte,
    reloj: &dyn Reloj,
    correo: &str,
    password: &str,
) -> Resultado<EstadoSesion> {
    // 1. Con lo que hay en la estación. Orden de candados: sesión, después base.
    let (correo, tenia_verificador, cred) = {
        let mut gestor = sesion.lock().map_err(|_| interno())?;
        let conn = base.lock().map_err(|_| interno())?;
        let ahora = reloj.ahora();
        exigir_operable(&conn, ahora)?;
        match gestor.intento_local(&conn, ahora, correo, password)? {
            IntentoLocal::Abierta(estado) => return Ok(estado),
            IntentoLocal::NecesitaServidor { correo, tenia_verificador } => {
                let cred = credenciales(&conn)?.ok_or_else(|| ErrorApp::nuevo("ESTACION_SIN_ACTIVAR", "Esta estación aún no está activada."))?;
                (correo, tenia_verificador, cred)
            }
        }
    };

    // 2. Se le pregunta al servidor, sin tener tomada la base mientras responde.
    let cuerpo = json!({ "correo": correo, "password": password });
    let respuesta = transporte.enviar(
        &cred.api_base,
        Peticion { metodo: Metodo::Post, ruta: "/sync/sesion-staff", token: Some(&cred.token), consulta: vec![], cuerpo: Some(&cuerpo) },
    );

    // 3. Se guarda el resultado.
    let mut gestor = sesion.lock().map_err(|_| interno())?;
    let conn = base.lock().map_err(|_| interno())?;
    let ahora = reloj.ahora();
    match respuesta {
        Ok(r) => {
            let s = &r["staff"];
            let invalida = || ErrorApp::nuevo("RESPUESTA_INVALIDA", "El servidor respondió algo que esta versión de GymDesk no entiende. Actualiza la aplicación.");
            let confirmado = StaffConfirmado {
                id: s["id"].as_str().ok_or_else(invalida)?,
                nombre: s["nombre"].as_str().ok_or_else(invalida)?,
                correo: s["correo"].as_str().ok_or_else(invalida)?,
                rol: s["rol"].as_str().ok_or_else(invalida)?,
                password_cambiada_en: s["password_cambiada_en"].as_str(),
            };
            gestor.confirmar_con_servidor(&conn, ahora, &confirmado, password)
        }
        Err(ErrorTransporte::SinConexion(_)) if !tenia_verificador => Err(ErrorApp::nuevo(
            "NECESITA_CONEXION",
            "Para tu primer ingreso en esta estación se necesita internet. Después podrás entrar sin red.",
        )),
        // Sin red y con verificador local: la contraseña escrita no coincide con la de esta estación.
        Err(ErrorTransporte::SinConexion(_)) => Err(gestor.registrar_fallo_password(&conn, ahora, &correo)?),
        Err(ErrorTransporte::Servidor { codigo, .. }) if codigo == "CREDENCIALES_INVALIDAS" => {
            Err(gestor.registrar_fallo_password(&conn, ahora, &correo)?)
        }
        Err(otro) => Err(otro.a_error_app()),
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db::pruebas::reloj;
    use crate::sync::pruebas_util::*;
    use chrono::Duration;
    use serde_json::json;

    const CORREO: &str = "ana@gimnasio.co";
    const PASSWORD: &str = "Recepcion2026*";

    fn respuesta_ok(cambiada: Option<&str>) -> serde_json::Value {
        json!({
            "staff": { "id": ANA, "nombre": "Ana Ruiz", "correo": "Ana@Gimnasio.co", "rol": "recepcionista", "password_cambiada_en": cambiada },
            "permisos": ["caja:crear"], "servidor_ahora": "2026-11-12T15:00:00Z"
        })
    }

    fn entrar(base: &Mutex<Connection>, sesion: &Mutex<GestorSesion>, t: &TransporteGuion, r: &dyn Reloj, password: &str) -> Resultado<EstadoSesion> {
        iniciar_con_password(base, sesion, t, r, CORREO, password)
    }

    #[test]
    fn el_primer_ingreso_se_valida_en_el_servidor_y_despues_se_entra_sin_red() {
        let (_dir, base) = base_activada();
        let sesion = Mutex::new(GestorSesion::default());
        let r = reloj();
        let t = TransporteGuion::con(vec![Ok(respuesta_ok(None))]);

        let estado = entrar(&base, &sesion, &t, &r, PASSWORD).unwrap();
        assert_eq!(estado.estado, "activa");
        assert_eq!(estado.usuario.unwrap().nombre, "Ana Ruiz");
        let pedido = t.pedidos.lock().unwrap()[0].clone();
        assert_eq!((pedido.0.as_str(), pedido.1.as_deref()), ("/sync/sesion-staff", Some("token-de-la-estacion")));

        // Lo guardado es un verificador propio de la estación, nunca la contraseña.
        let hash: String = base.lock().unwrap().query_row("SELECT hash_password FROM staff_local", [], |f| f.get(0)).unwrap();
        assert!(hash.starts_with("$argon2id$") && !hash.contains(PASSWORD));

        sesion.lock().unwrap().cerrar(&base.lock().unwrap(), r.ahora()).unwrap();
        // Segundo ingreso: el transporte ya no tiene respuestas (sin red) y aun así entra.
        assert_eq!(entrar(&base, &sesion, &t, &r, PASSWORD).unwrap().estado, "activa");
        assert_eq!(t.rutas().len(), 1, "el segundo ingreso no debe salir a la red");
    }

    #[test]
    fn sin_red_el_primer_ingreso_pide_conexion_y_no_cuenta_como_intento_fallido() {
        let (_dir, base) = base_activada();
        let sesion = Mutex::new(GestorSesion::default());
        let t = TransporteGuion::default();
        for _ in 0..6 {
            assert_eq!(entrar(&base, &sesion, &t, &reloj(), PASSWORD).unwrap_err().codigo, "NECESITA_CONEXION");
        }
        let intentos: i64 = base.lock().unwrap().query_row("SELECT count(*) FROM intentos_ingreso", [], |f| f.get(0)).unwrap();
        assert_eq!(intentos, 0);
    }

    #[test]
    fn si_el_servidor_rechaza_la_contrasena_no_entra_y_al_quinto_fallo_se_bloquea() {
        let (_dir, base) = base_activada();
        let sesion = Mutex::new(GestorSesion::default());
        let r = reloj();
        let t = TransporteGuion::con((0..5).map(|_| Err(error_servidor(401, "CREDENCIALES_INVALIDAS", None))).collect());
        for _ in 0..5 {
            assert_eq!(entrar(&base, &sesion, &t, &r, "mala").unwrap_err().codigo, "CREDENCIALES_INVALIDAS");
        }
        assert_eq!(entrar(&base, &sesion, &t, &r, PASSWORD).unwrap_err().codigo, "INGRESO_BLOQUEADO");
        assert_eq!(t.rutas().len(), 5, "bloqueada, ni siquiera consulta al servidor");
        let vacia: i64 = base.lock().unwrap().query_row("SELECT count(*) FROM staff_local", [], |f| f.get(0)).unwrap();
        assert_eq!(vacia, 0);
    }

    #[test]
    fn con_verificador_local_y_sin_red_una_contrasena_distinta_es_un_fallo() {
        let (_dir, base) = base_activada();
        let sesion = Mutex::new(GestorSesion::default());
        let r = reloj();
        let t = TransporteGuion::con(vec![Ok(respuesta_ok(None))]);
        entrar(&base, &sesion, &t, &r, PASSWORD).unwrap();
        sesion.lock().unwrap().cerrar(&base.lock().unwrap(), r.ahora()).unwrap();

        assert_eq!(entrar(&base, &sesion, &t, &r, "otra").unwrap_err().codigo, "CREDENCIALES_INVALIDAS");
        let fallos: i64 = base.lock().unwrap().query_row("SELECT count(*) FROM intentos_ingreso WHERE exito = 0", [], |f| f.get(0)).unwrap();
        assert_eq!(fallos, 1);
    }

    #[test]
    fn si_cambio_la_contrasena_en_la_web_la_nueva_entra_con_red_y_reemplaza_el_verificador() {
        let (_dir, base) = base_activada();
        let sesion = Mutex::new(GestorSesion::default());
        let r = reloj();
        let t = TransporteGuion::con(vec![Ok(respuesta_ok(None)), Ok(respuesta_ok(Some("2026-11-12T16:00:00+00:00")))]);
        entrar(&base, &sesion, &t, &r, PASSWORD).unwrap();
        sesion.lock().unwrap().cerrar(&base.lock().unwrap(), r.ahora()).unwrap();

        assert_eq!(entrar(&base, &sesion, &t, &r, "NuevaClave2026*").unwrap().estado, "activa");
        sesion.lock().unwrap().cerrar(&base.lock().unwrap(), r.ahora()).unwrap();
        // Sin red: sirve la nueva y ya no la vieja.
        assert_eq!(entrar(&base, &sesion, &t, &r, "NuevaClave2026*").unwrap().estado, "activa");
        sesion.lock().unwrap().cerrar(&base.lock().unwrap(), r.ahora()).unwrap();
        assert_eq!(entrar(&base, &sesion, &t, &r, PASSWORD).unwrap_err().codigo, "CREDENCIALES_INVALIDAS");
        let marca: Option<String> = base.lock().unwrap().query_row("SELECT credencial_marca FROM staff_local", [], |f| f.get(0)).unwrap();
        assert_eq!(marca.as_deref(), Some("2026-11-12T16:00:00+00:00"));
    }

    #[test]
    fn los_demas_rechazos_del_servidor_se_muestran_tal_cual_y_no_cuentan_como_fallo() {
        let (_dir, base) = base_activada();
        let sesion = Mutex::new(GestorSesion::default());
        let t = TransporteGuion::con(vec![
            Err(error_servidor(409, "DEBE_CAMBIAR_PASSWORD", None)),
            Err(error_servidor(429, "CUENTA_BLOQUEADA_TEMPORALMENTE", None)),
        ]);
        assert_eq!(entrar(&base, &sesion, &t, &reloj(), PASSWORD).unwrap_err().codigo, "DEBE_CAMBIAR_PASSWORD");
        assert_eq!(entrar(&base, &sesion, &t, &reloj(), PASSWORD).unwrap_err().codigo, "CUENTA_BLOQUEADA_TEMPORALMENTE");
        let intentos: i64 = base.lock().unwrap().query_row("SELECT count(*) FROM intentos_ingreso", [], |f| f.get(0)).unwrap();
        assert_eq!(intentos, 0);
    }

    #[test]
    fn con_el_gimnasio_bloqueado_nadie_inicia_sesion_aunque_no_haya_red() {
        let (_dir, base) = base_activada();
        let sesion = Mutex::new(GestorSesion::default());
        let r = reloj();
        let t = TransporteGuion::con(vec![Ok(respuesta_ok(None))]);
        entrar(&base, &sesion, &t, &r, PASSWORD).unwrap();
        sesion.lock().unwrap().cerrar(&base.lock().unwrap(), r.ahora()).unwrap();

        // Última descarga: corte el 10-nov. Hoy (reloj de pruebas) es 12-nov: en gracia, opera.
        base.lock().unwrap().execute("UPDATE suscripcion SET estado_guardado = 'activo', fecha_corte = '2026-11-10'", []).unwrap();
        assert_eq!(entrar(&base, &sesion, &t, &r, PASSWORD).unwrap().estado, "activa");
        sesion.lock().unwrap().cerrar(&base.lock().unwrap(), r.ahora()).unwrap();

        // Dos días después, sin haber tenido red: la estación se bloquea sola.
        r.avanzar(Duration::days(2));
        let err = entrar(&base, &sesion, &t, &r, PASSWORD).unwrap_err();
        assert_eq!(err.codigo, "GIMNASIO_SUSPENDIDO");
        assert_eq!(err.detalles.unwrap()["motivo"], "falta_pago");
    }

    #[test]
    fn revalidar_cierra_la_sesion_de_quien_perdio_su_credencial() {
        let (_dir, base) = base_activada();
        let sesion = Mutex::new(GestorSesion::default());
        let r = reloj();
        let t = TransporteGuion::con(vec![Ok(respuesta_ok(None))]);
        entrar(&base, &sesion, &t, &r, PASSWORD).unwrap();

        let conn = base.lock().unwrap();
        let mut gestor = sesion.lock().unwrap();
        gestor.revalidar(&conn, r.ahora()).unwrap();
        assert_eq!(gestor.estado(&conn, r.ahora()).unwrap().estado, "activa");

        conn.execute("UPDATE staff_local SET hash_password = NULL, hash_pin = NULL", []).unwrap();
        gestor.revalidar(&conn, r.ahora()).unwrap();
        assert_eq!(gestor.estado(&conn, r.ahora()).unwrap().estado, "sin_sesion");
    }
}
