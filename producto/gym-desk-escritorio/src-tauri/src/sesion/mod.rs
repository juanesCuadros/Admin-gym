//! Sesión del personal en la estación.
//!
//! - Ingreso con correo + contraseña, o eligiendo a la persona + PIN de 4 números.
//! - 5 intentos fallidos bloquean ese ingreso 15 minutos (P-16); un éxito reinicia la cuenta.
//! - 5 minutos sin actividad bloquean la pantalla; se desbloquea con PIN o contraseña.
//! - La regla vive aquí, no en la interfaz: la pantalla solo la refleja.

pub mod credenciales;

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::json;

use crate::auditoria::{self, Actor};
use crate::error::{ErrorApp, Resultado};
use crate::reloj::a_texto;

pub const MINUTOS_INACTIVIDAD: i64 = 5;
pub const MAX_INTENTOS_FALLIDOS: i64 = 5;
pub const MINUTOS_BLOQUEO_INTENTOS: i64 = 15;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UsuarioSesion {
    pub id: String,
    pub nombre: String,
    pub correo: String,
    pub rol: String,
    pub tiene_pin: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EstadoSesion {
    /// `sin_sesion` | `activa` | `bloqueada`
    pub estado: &'static str,
    pub usuario: Option<UsuarioSesion>,
    pub minutos_inactividad: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PersonaConPin {
    pub id: String,
    pub nombre: String,
}

#[derive(Clone, Copy)]
pub enum Credencial<'a> {
    Password(&'a str),
    Pin(&'a str),
}

impl Credencial<'_> {
    fn metodo(&self) -> &'static str {
        match self {
            Credencial::Password(_) => "contrasena",
            Credencial::Pin(_) => "pin",
        }
    }
}

struct FilaStaff {
    id: String,
    nombre: String,
    correo: String,
    rol: String,
    activo: bool,
    hash_password: Option<String>,
    hash_pin: Option<String>,
}

impl FilaStaff {
    fn a_usuario(&self) -> UsuarioSesion {
        UsuarioSesion {
            id: self.id.clone(),
            nombre: self.nombre.clone(),
            correo: self.correo.clone(),
            rol: self.rol.clone(),
            tiene_pin: self.hash_pin.is_some(),
        }
    }
}

struct SesionActiva {
    usuario: UsuarioSesion,
    bloqueada: bool,
    ultima_actividad: DateTime<Utc>,
}

#[derive(Default)]
pub struct GestorSesion {
    activa: Option<SesionActiva>,
}

fn buscar_staff(conn: &Connection, columna: &str, valor: &str) -> Resultado<Option<FilaStaff>> {
    // `columna` solo recibe los dos literales de este módulo.
    let sql = format!(
        "SELECT id, nombre, correo, rol, activo, hash_password, hash_pin FROM staff_local WHERE {columna} = ?1"
    );
    Ok(conn
        .query_row(&sql, [valor], |f| {
            Ok(FilaStaff {
                id: f.get(0)?,
                nombre: f.get(1)?,
                correo: f.get(2)?,
                rol: f.get(3)?,
                activo: f.get::<_, i64>(4)? == 1,
                hash_password: f.get(5)?,
                hash_pin: f.get(6)?,
            })
        })
        .optional()?)
}

/// 5 o más fallos seguidos (sin un éxito posterior) dentro de los últimos 15 minutos.
fn esta_bloqueado(conn: &Connection, identificador: &str, ahora: DateTime<Utc>) -> Resultado<bool> {
    let desde = a_texto(ahora - Duration::minutes(MINUTOS_BLOQUEO_INTENTOS));
    let fallos: i64 = conn.query_row(
        "SELECT count(*) FROM intentos_ingreso
         WHERE identificador = ?1 AND exito = 0 AND ts_utc > ?2
           AND id > COALESCE((SELECT max(id) FROM intentos_ingreso WHERE identificador = ?1 AND exito = 1), 0)",
        params![identificador, desde],
        |f| f.get(0),
    )?;
    Ok(fallos >= MAX_INTENTOS_FALLIDOS)
}

fn error_bloqueo() -> ErrorApp {
    ErrorApp::con_detalles(
        "INGRESO_BLOQUEADO",
        "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo.",
        json!({ "minutos": MINUTOS_BLOQUEO_INTENTOS }),
    )
}

fn error_credenciales(cred: &Credencial<'_>) -> ErrorApp {
    match cred {
        Credencial::Password(_) => ErrorApp::nuevo("CREDENCIALES_INVALIDAS", "Correo o contraseña incorrectos."),
        Credencial::Pin(_) => ErrorApp::nuevo("CREDENCIALES_INVALIDAS", "PIN incorrecto."),
    }
}

fn error_sin_sesion() -> ErrorApp {
    ErrorApp::nuevo("SIN_SESION", "No hay una sesión iniciada en esta estación.")
}

/// Verifica una credencial, cuenta el intento y lo deja en auditoría, todo en una transacción.
fn verificar_credencial(
    conn: &Connection,
    ahora: DateTime<Utc>,
    identificador: &str,
    staff: Option<&FilaStaff>,
    cred: &Credencial<'_>,
    accion_exito: Option<&str>,
) -> Resultado<()> {
    if esta_bloqueado(conn, identificador, ahora)? {
        return Err(error_bloqueo());
    }

    let (secreto, hash) = match cred {
        Credencial::Password(p) => (*p, staff.and_then(|s| s.hash_password.as_deref())),
        Credencial::Pin(p) => (*p, staff.and_then(|s| s.hash_pin.as_deref())),
    };
    let valido = match (staff, hash) {
        (Some(s), Some(h)) if s.activo => credenciales::verificar(secreto, h),
        _ => {
            credenciales::verificar_en_vacio(secreto);
            false
        }
    };

    let actor = match staff {
        Some(s) => Actor::persona(&s.id, &s.nombre),
        None => Actor::sistema(),
    };
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO intentos_ingreso (identificador, exito, ts_utc) VALUES (?1, ?2, ?3)",
        params![identificador, valido as i64, a_texto(ahora)],
    )?;
    let accion = if valido { accion_exito } else { Some("INGRESO_FALLIDO") };
    if let Some(accion) = accion {
        auditoria::registrar(
            &tx,
            ahora,
            actor,
            accion,
            "staff_local",
            staff.map(|s| s.id.as_str()),
            &json!({ "metodo": cred.metodo() }),
        )?;
    }
    tx.commit()?;

    if valido {
        Ok(())
    } else {
        Err(error_credenciales(cred))
    }
}

impl GestorSesion {
    fn estado_actual(&self) -> EstadoSesion {
        match &self.activa {
            None => EstadoSesion { estado: "sin_sesion", usuario: None, minutos_inactividad: MINUTOS_INACTIVIDAD },
            Some(s) => EstadoSesion {
                estado: if s.bloqueada { "bloqueada" } else { "activa" },
                usuario: Some(s.usuario.clone()),
                minutos_inactividad: MINUTOS_INACTIVIDAD,
            },
        }
    }

    fn bloquear_con_motivo(&mut self, conn: &Connection, ahora: DateTime<Utc>, motivo: &str) -> Resultado<()> {
        if let Some(s) = self.activa.as_mut() {
            if !s.bloqueada {
                auditoria::registrar(
                    conn,
                    ahora,
                    Actor::persona(&s.usuario.id, &s.usuario.nombre),
                    "BLOQUEAR_SESION",
                    "staff_local",
                    Some(&s.usuario.id),
                    &json!({ "motivo": motivo }),
                )?;
                s.bloqueada = true;
            }
        }
        Ok(())
    }

    /// Bloquea si ya pasaron 5 minutos desde la última actividad.
    fn aplicar_inactividad(&mut self, conn: &Connection, ahora: DateTime<Utc>) -> Resultado<()> {
        let vencida = matches!(&self.activa, Some(s) if !s.bloqueada
            && ahora - s.ultima_actividad >= Duration::minutes(MINUTOS_INACTIVIDAD));
        if vencida {
            self.bloquear_con_motivo(conn, ahora, "inactividad")?;
        }
        Ok(())
    }

    /// Exige una sesión abierta y desbloqueada. Lo usa todo comando protegido.
    pub fn exigir_activa(&mut self, conn: &Connection, ahora: DateTime<Utc>) -> Resultado<UsuarioSesion> {
        self.aplicar_inactividad(conn, ahora)?;
        match &self.activa {
            None => Err(error_sin_sesion()),
            Some(s) if s.bloqueada => {
                Err(ErrorApp::nuevo("SESION_BLOQUEADA", "La estación está bloqueada. Desbloquéala con tu PIN o contraseña."))
            }
            Some(s) => Ok(s.usuario.clone()),
        }
    }

    pub fn estado(&mut self, conn: &Connection, ahora: DateTime<Utc>) -> Resultado<EstadoSesion> {
        self.aplicar_inactividad(conn, ahora)?;
        Ok(self.estado_actual())
    }

    /// La interfaz avisa que hubo teclado o ratón. Una sesión ya vencida no revive.
    pub fn registrar_actividad(&mut self, conn: &Connection, ahora: DateTime<Utc>) -> Resultado<EstadoSesion> {
        self.aplicar_inactividad(conn, ahora)?;
        if let Some(s) = self.activa.as_mut() {
            if !s.bloqueada {
                s.ultima_actividad = ahora;
            }
        }
        Ok(self.estado_actual())
    }

    fn abrir(&mut self, staff: &FilaStaff, ahora: DateTime<Utc>) -> EstadoSesion {
        self.activa = Some(SesionActiva { usuario: staff.a_usuario(), bloqueada: false, ultima_actividad: ahora });
        self.estado_actual()
    }

    fn exigir_sin_sesion(&self) -> Resultado<()> {
        match &self.activa {
            Some(_) => Err(ErrorApp::nuevo(
                "SESION_YA_ABIERTA",
                "Ya hay una sesión en esta estación. Ciérrala antes de entrar con otro usuario.",
            )),
            None => Ok(()),
        }
    }

    pub fn iniciar_con_password(
        &mut self,
        conn: &Connection,
        ahora: DateTime<Utc>,
        correo: &str,
        password: &str,
    ) -> Resultado<EstadoSesion> {
        self.exigir_sin_sesion()?;
        let correo = correo.trim().to_lowercase();
        if correo.is_empty() || password.is_empty() {
            return Err(ErrorApp::nuevo("DATOS_INCOMPLETOS", "Escribe tu correo y tu contraseña."));
        }
        let staff = buscar_staff(conn, "correo", &correo)?;
        let cred = Credencial::Password(password);
        verificar_credencial(conn, ahora, &correo, staff.as_ref(), &cred, Some("INICIAR_SESION"))?;
        Ok(self.abrir(staff.as_ref().expect("credencial válida implica staff"), ahora))
    }

    pub fn iniciar_con_pin(
        &mut self,
        conn: &Connection,
        ahora: DateTime<Utc>,
        staff_id: &str,
        pin: &str,
    ) -> Resultado<EstadoSesion> {
        self.exigir_sin_sesion()?;
        let staff = buscar_staff(conn, "id", staff_id)?;
        let cred = Credencial::Pin(pin);
        verificar_credencial(conn, ahora, staff_id, staff.as_ref(), &cred, Some("INICIAR_SESION"))?;
        Ok(self.abrir(staff.as_ref().expect("credencial válida implica staff"), ahora))
    }

    pub fn desbloquear(&mut self, conn: &Connection, ahora: DateTime<Utc>, cred: Credencial<'_>) -> Resultado<EstadoSesion> {
        self.aplicar_inactividad(conn, ahora)?;
        let (id, correo) = match &self.activa {
            None => return Err(error_sin_sesion()),
            Some(s) if !s.bloqueada => return Ok(self.estado_actual()),
            Some(s) => (s.usuario.id.clone(), s.usuario.correo.clone()),
        };
        // Se vuelve a leer a la persona: si la desactivaron, ya no desbloquea.
        let staff = buscar_staff(conn, "id", &id)?;
        let identificador = match cred {
            Credencial::Password(_) => correo,
            Credencial::Pin(_) => id,
        };
        verificar_credencial(conn, ahora, &identificador, staff.as_ref(), &cred, Some("DESBLOQUEAR_SESION"))?;
        Ok(self.abrir(staff.as_ref().expect("credencial válida implica staff"), ahora))
    }

    pub fn bloquear(&mut self, conn: &Connection, ahora: DateTime<Utc>) -> Resultado<EstadoSesion> {
        self.aplicar_inactividad(conn, ahora)?;
        self.bloquear_con_motivo(conn, ahora, "manual")?;
        Ok(self.estado_actual())
    }

    /// Cerrar sesión se permite también con la pantalla bloqueada, para que otra persona pueda entrar.
    pub fn cerrar(&mut self, conn: &Connection, ahora: DateTime<Utc>) -> Resultado<EstadoSesion> {
        if let Some(s) = self.activa.take() {
            auditoria::registrar(
                conn,
                ahora,
                Actor::persona(&s.usuario.id, &s.usuario.nombre),
                "CERRAR_SESION",
                "staff_local",
                Some(&s.usuario.id),
                &json!({ "estaba_bloqueada": s.bloqueada }),
            )?;
        }
        Ok(self.estado_actual())
    }

    /// Crea o cambia el PIN de quien tiene la sesión. Siempre pide la contraseña.
    pub fn definir_pin(
        &mut self,
        conn: &Connection,
        ahora: DateTime<Utc>,
        password_actual: &str,
        pin: &str,
    ) -> Resultado<EstadoSesion> {
        let usuario = self.exigir_activa(conn, ahora)?;
        credenciales::validar_formato_pin(pin)?;
        let staff = buscar_staff(conn, "id", &usuario.id)?;
        verificar_credencial(conn, ahora, &usuario.correo, staff.as_ref(), &Credencial::Password(password_actual), None)
            .map_err(|e| {
                if e.codigo == "CREDENCIALES_INVALIDAS" {
                    ErrorApp::nuevo("CREDENCIALES_INVALIDAS", "Contraseña incorrecta.")
                } else {
                    e
                }
            })?;

        let hash = credenciales::generar_hash(pin)?;
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE staff_local SET hash_pin = ?1, pin_creado_en = ?2, actualizado_en = ?2 WHERE id = ?3",
            params![hash, a_texto(ahora), usuario.id],
        )?;
        auditoria::registrar(
            &tx,
            ahora,
            Actor::persona(&usuario.id, &usuario.nombre),
            if usuario.tiene_pin { "CAMBIAR_PIN" } else { "CREAR_PIN" },
            "staff_local",
            Some(&usuario.id),
            &json!({}),
        )?;
        tx.commit()?;

        if let Some(s) = self.activa.as_mut() {
            s.usuario.tiene_pin = true;
            s.ultima_actividad = ahora;
        }
        Ok(self.estado_actual())
    }
}

/// Personas activas que ya crearon su PIN en esta estación (para elegir quién entra).
pub fn personal_con_pin(conn: &Connection) -> Resultado<Vec<PersonaConPin>> {
    let mut stmt = conn.prepare(
        "SELECT id, nombre FROM staff_local WHERE activo = 1 AND hash_pin IS NOT NULL ORDER BY nombre COLLATE NOCASE",
    )?;
    let filas = stmt.query_map([], |f| Ok(PersonaConPin { id: f.get(0)?, nombre: f.get(1)? }))?;
    Ok(filas.collect::<Result<Vec<_>, _>>()?)
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db::pruebas::{base_temporal, reloj};
    use crate::reloj::pruebas::RelojFijo;
    use crate::reloj::Reloj;

    const CORREO: &str = "ana@gimnasio.co";
    const PASSWORD: &str = "Recepcion2026*";

    /// Datos de prueba: en la app real el personal llega por la sincronización (fase 1).
    fn insertar_staff(conn: &Connection, id: &str, nombre: &str, correo: &str, password: &str, activo: bool) {
        conn.execute(
            "INSERT INTO staff_local (id, nombre, correo, rol, activo, hash_password, actualizado_en)
             VALUES (?1, ?2, ?3, 'recepcionista', ?4, ?5, '2026-11-12T15:00:00.000Z')",
            params![id, nombre, correo, activo as i64, credenciales::generar_hash(password).unwrap()],
        )
        .unwrap();
    }

    fn preparar() -> (tempfile::TempDir, Connection, RelojFijo, GestorSesion) {
        let (dir, conn) = base_temporal();
        insertar_staff(&conn, "s-ana", "Ana Ruiz", CORREO, PASSWORD, true);
        (dir, conn, reloj(), GestorSesion::default())
    }

    fn acciones(conn: &Connection) -> Vec<String> {
        let mut stmt = conn.prepare("SELECT accion FROM auditoria_local ORDER BY id").unwrap();
        let filas = stmt.query_map([], |f| f.get(0)).unwrap();
        filas.map(|a| a.unwrap()).collect()
    }

    #[test]
    fn en_una_estacion_sin_personal_nadie_entra() {
        let (_dir, conn) = base_temporal();
        let mut g = GestorSesion::default();
        let err = g.iniciar_con_password(&conn, reloj().ahora(), CORREO, PASSWORD).unwrap_err();
        assert_eq!(err.codigo, "CREDENCIALES_INVALIDAS");
        assert!(personal_con_pin(&conn).unwrap().is_empty());
    }

    #[test]
    fn con_la_contrasena_correcta_entra() {
        let (_dir, conn, r, mut g) = preparar();
        let estado = g.iniciar_con_password(&conn, r.ahora(), "  Ana@Gimnasio.CO ", PASSWORD).unwrap();
        assert_eq!(estado.estado, "activa");
        let u = estado.usuario.unwrap();
        assert_eq!((u.nombre.as_str(), u.rol.as_str(), u.tiene_pin), ("Ana Ruiz", "recepcionista", false));
    }

    #[test]
    fn con_la_contrasena_incorrecta_no_entra_y_el_mensaje_no_dice_cual_dato_fallo() {
        let (_dir, conn, r, mut g) = preparar();
        let mala = g.iniciar_con_password(&conn, r.ahora(), CORREO, "otra").unwrap_err();
        let inexistente = g.iniciar_con_password(&conn, r.ahora(), "nadie@gimnasio.co", PASSWORD).unwrap_err();
        assert_eq!(mala, inexistente);
        assert_eq!(mala.codigo, "CREDENCIALES_INVALIDAS");
        assert_eq!(g.estado(&conn, r.ahora()).unwrap().estado, "sin_sesion");
    }

    #[test]
    fn una_persona_desactivada_no_entra_ni_con_la_contrasena_correcta() {
        let (_dir, conn, r, mut g) = preparar();
        insertar_staff(&conn, "s-luis", "Luis", "luis@gimnasio.co", PASSWORD, false);
        let err = g.iniciar_con_password(&conn, r.ahora(), "luis@gimnasio.co", PASSWORD).unwrap_err();
        assert_eq!(err.codigo, "CREDENCIALES_INVALIDAS");
    }

    #[test]
    fn al_quinto_fallo_se_bloquea_15_minutos_aunque_luego_escriba_bien() {
        let (_dir, conn, r, mut g) = preparar();
        for _ in 0..5 {
            assert_eq!(g.iniciar_con_password(&conn, r.ahora(), CORREO, "mala").unwrap_err().codigo, "CREDENCIALES_INVALIDAS");
            r.avanzar(Duration::seconds(10));
        }
        let err = g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap_err();
        assert_eq!(err.codigo, "INGRESO_BLOQUEADO");
        assert_eq!(err.detalles.unwrap()["minutos"], 15);

        r.avanzar(Duration::minutes(14));
        assert_eq!(g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap_err().codigo, "INGRESO_BLOQUEADO");

        r.avanzar(Duration::minutes(1));
        assert_eq!(g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap().estado, "activa");
    }

    #[test]
    fn el_bloqueo_de_una_persona_no_afecta_a_otra() {
        let (_dir, conn, r, mut g) = preparar();
        insertar_staff(&conn, "s-luis", "Luis", "luis@gimnasio.co", PASSWORD, true);
        for _ in 0..5 {
            let _ = g.iniciar_con_password(&conn, r.ahora(), CORREO, "mala");
        }
        assert_eq!(g.iniciar_con_password(&conn, r.ahora(), "luis@gimnasio.co", PASSWORD).unwrap().estado, "activa");
    }

    #[test]
    fn un_ingreso_exitoso_reinicia_la_cuenta_de_fallos() {
        let (_dir, conn, r, mut g) = preparar();
        for _ in 0..4 {
            let _ = g.iniciar_con_password(&conn, r.ahora(), CORREO, "mala");
        }
        g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap();
        g.cerrar(&conn, r.ahora()).unwrap();
        for _ in 0..4 {
            let _ = g.iniciar_con_password(&conn, r.ahora(), CORREO, "mala");
        }
        assert_eq!(g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap().estado, "activa");
    }

    #[test]
    fn crear_el_pin_pide_la_contrasena_y_despues_se_entra_con_pin() {
        let (_dir, conn, r, mut g) = preparar();
        g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap();

        assert_eq!(g.definir_pin(&conn, r.ahora(), "mala", "4821").unwrap_err().mensaje, "Contraseña incorrecta.");
        assert_eq!(g.definir_pin(&conn, r.ahora(), PASSWORD, "48").unwrap_err().codigo, "PIN_INVALIDO");
        assert!(personal_con_pin(&conn).unwrap().is_empty());

        let estado = g.definir_pin(&conn, r.ahora(), PASSWORD, "4821").unwrap();
        assert!(estado.usuario.unwrap().tiene_pin);
        assert_eq!(personal_con_pin(&conn).unwrap(), vec![PersonaConPin { id: "s-ana".into(), nombre: "Ana Ruiz".into() }]);

        g.cerrar(&conn, r.ahora()).unwrap();
        assert_eq!(g.iniciar_con_pin(&conn, r.ahora(), "s-ana", "0000").unwrap_err().mensaje, "PIN incorrecto.");
        assert_eq!(g.iniciar_con_pin(&conn, r.ahora(), "s-ana", "4821").unwrap().estado, "activa");
    }

    #[test]
    fn el_pin_tambien_se_bloquea_al_quinto_fallo() {
        let (_dir, conn, r, mut g) = preparar();
        g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap();
        g.definir_pin(&conn, r.ahora(), PASSWORD, "4821").unwrap();
        g.cerrar(&conn, r.ahora()).unwrap();
        for _ in 0..5 {
            let _ = g.iniciar_con_pin(&conn, r.ahora(), "s-ana", "0000");
        }
        assert_eq!(g.iniciar_con_pin(&conn, r.ahora(), "s-ana", "4821").unwrap_err().codigo, "INGRESO_BLOQUEADO");
        // La contraseña sigue sirviendo: son cuentas de intentos separadas.
        assert_eq!(g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap().estado, "activa");
    }

    #[test]
    fn a_los_5_minutos_sin_actividad_se_bloquea() {
        let (_dir, conn, r, mut g) = preparar();
        g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap();

        r.avanzar(Duration::seconds(4 * 60 + 59));
        assert_eq!(g.estado(&conn, r.ahora()).unwrap().estado, "activa");

        r.avanzar(Duration::seconds(1));
        assert_eq!(g.estado(&conn, r.ahora()).unwrap().estado, "bloqueada");
        assert_eq!(g.exigir_activa(&conn, r.ahora()).unwrap_err().codigo, "SESION_BLOQUEADA");
    }

    #[test]
    fn la_actividad_reinicia_la_cuenta_pero_no_revive_una_sesion_vencida() {
        let (_dir, conn, r, mut g) = preparar();
        g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap();

        r.avanzar(Duration::minutes(4));
        assert_eq!(g.registrar_actividad(&conn, r.ahora()).unwrap().estado, "activa");
        r.avanzar(Duration::minutes(4));
        assert_eq!(g.estado(&conn, r.ahora()).unwrap().estado, "activa");

        r.avanzar(Duration::minutes(6));
        assert_eq!(g.registrar_actividad(&conn, r.ahora()).unwrap().estado, "bloqueada");
    }

    #[test]
    fn se_desbloquea_con_pin_o_con_contrasena_y_no_con_datos_malos() {
        let (_dir, conn, r, mut g) = preparar();
        g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap();
        g.definir_pin(&conn, r.ahora(), PASSWORD, "4821").unwrap();

        g.bloquear(&conn, r.ahora()).unwrap();
        assert_eq!(g.desbloquear(&conn, r.ahora(), Credencial::Pin("1111")).unwrap_err().codigo, "CREDENCIALES_INVALIDAS");
        assert_eq!(g.estado(&conn, r.ahora()).unwrap().estado, "bloqueada");
        assert_eq!(g.desbloquear(&conn, r.ahora(), Credencial::Pin("4821")).unwrap().estado, "activa");

        g.bloquear(&conn, r.ahora()).unwrap();
        assert_eq!(g.desbloquear(&conn, r.ahora(), Credencial::Password(PASSWORD)).unwrap().estado, "activa");
    }

    #[test]
    fn si_desactivan_a_la_persona_ya_no_puede_desbloquear() {
        let (_dir, conn, r, mut g) = preparar();
        g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap();
        g.bloquear(&conn, r.ahora()).unwrap();
        conn.execute("UPDATE staff_local SET activo = 0 WHERE id = 's-ana'", []).unwrap();
        let err = g.desbloquear(&conn, r.ahora(), Credencial::Password(PASSWORD)).unwrap_err();
        assert_eq!(err.codigo, "CREDENCIALES_INVALIDAS");
    }

    #[test]
    fn con_la_pantalla_bloqueada_no_se_puede_cambiar_el_pin_pero_si_cerrar_sesion() {
        let (_dir, conn, r, mut g) = preparar();
        g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap();
        g.bloquear(&conn, r.ahora()).unwrap();
        assert_eq!(g.definir_pin(&conn, r.ahora(), PASSWORD, "4821").unwrap_err().codigo, "SESION_BLOQUEADA");
        assert_eq!(g.cerrar(&conn, r.ahora()).unwrap().estado, "sin_sesion");
        assert_eq!(g.exigir_activa(&conn, r.ahora()).unwrap_err().codigo, "SIN_SESION");
    }

    #[test]
    fn no_se_abre_una_segunda_sesion_encima_de_otra() {
        let (_dir, conn, r, mut g) = preparar();
        g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap();
        let err = g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap_err();
        assert_eq!(err.codigo, "SESION_YA_ABIERTA");
    }

    #[test]
    fn todo_queda_en_auditoria_sin_contrasenas_ni_pin_y_con_la_cadena_integra() {
        let (_dir, conn, r, mut g) = preparar();
        let _ = g.iniciar_con_password(&conn, r.ahora(), CORREO, "ClaveMalaEscrita");
        g.iniciar_con_password(&conn, r.ahora(), CORREO, PASSWORD).unwrap();
        g.definir_pin(&conn, r.ahora(), PASSWORD, "4821").unwrap();
        r.avanzar(Duration::minutes(5));
        g.estado(&conn, r.ahora()).unwrap();
        g.desbloquear(&conn, r.ahora(), Credencial::Pin("4821")).unwrap();
        g.cerrar(&conn, r.ahora()).unwrap();

        assert_eq!(
            acciones(&conn),
            ["CREAR_BASE_LOCAL", "INGRESO_FALLIDO", "INICIAR_SESION", "CREAR_PIN", "BLOQUEAR_SESION", "DESBLOQUEAR_SESION", "CERRAR_SESION"]
        );
        let todo: String = conn
            .query_row("SELECT group_concat(detalle || coalesce(entidad_id,''), ' ') FROM auditoria_local", [], |f| f.get(0))
            .unwrap();
        for secreto in [PASSWORD, "ClaveMalaEscrita", "4821", "$argon2"] {
            assert!(!todo.contains(secreto), "la auditoría no debe contener {secreto}");
        }
        assert!(todo.contains("inactividad"));
        assert_eq!(auditoria::primera_fila_alterada(&conn).unwrap(), None);
    }
}
