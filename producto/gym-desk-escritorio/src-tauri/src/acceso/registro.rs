//! Evalúa y registra ingresos contra la base local.
//!
//! Hace lo mismo que `ControlIngresoService` del servidor, con lo último que se descargó:
//! elige la membresía igual, mira congelamientos y pase de día, ignora relecturas de 3 segundos y
//! guarda cada intento, permitido o negado. El ingreso y su operación en la cola se escriben en la
//! misma transacción.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::json;

use crate::acceso::regla::{self, Entrada};
use crate::auditoria::{self, Actor};
use crate::error::{ErrorApp, Resultado};
use crate::reloj::{a_texto, fecha_negocio};
use crate::sesion::UsuarioSesion;
use crate::sync::outbox;

/// Una segunda lectura de la misma persona dentro de esta ventana no se registra.
pub const ANTIRREBOTE_SEGUNDOS: i64 = 3;
const MOTIVO_MINIMO: usize = 4;
const MAX_RESULTADOS_BUSQUEDA: usize = 8;
const MAX_INGRESOS_LISTADOS: i64 = 50;

#[derive(Debug, Clone, Serialize)]
pub struct ClienteEvaluado {
    pub id: String,
    pub nombre: String,
    pub tipo_documento: Option<String>,
    pub documento: String,
    pub plan_nombre: Option<String>,
    pub fecha_vencimiento: Option<String>,
    /// desactivado | cancelado | sin_membresia | congelado | vencido | en_gracia | por_vencer | activo
    pub estado: &'static str,
    pub dias_restantes_o_vencido: i64,
    pub con_pase_dia: bool,
    pub abre: bool,
    /// abrio | alerta_mora | negado
    pub resultado: &'static str,
    pub mensaje: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ResultadoIngreso {
    /// Id del ingreso guardado. `None` si fue una relectura ignorada.
    pub id: Option<String>,
    /// ingreso | cortesia
    pub tipo: &'static str,
    pub relectura_ignorada: bool,
    pub abre: bool,
    pub resultado: String,
    pub mensaje: String,
    pub cliente: Option<ClienteEvaluado>,
    pub ocurrido_en: String,
}

fn error_sin_datos() -> ErrorApp {
    ErrorApp::nuevo("DATOS_SIN_DESCARGAR", "Esta estación aún no ha descargado los datos del gimnasio. Conéctala a internet.")
}

fn error_no_encontrado() -> ErrorApp {
    ErrorApp::nuevo("CLIENTE_NO_ENCONTRADO", "No hay un cliente con ese documento en esta estación.")
}

/// Permiso del rol según lo descargado. El Jefe lo tiene todo; sin fila de permiso, no (se cierra).
pub fn exigir_permiso_ingreso(conn: &Connection, usuario: &UsuarioSesion) -> Resultado<()> {
    if usuario.rol == "jefe" {
        return Ok(());
    }
    let puede: Option<bool> = conn
        .query_row("SELECT puede_crear FROM permisos_rol WHERE rol = ?1 AND submodulo = 'control_ingreso'", [&usuario.rol], |f| f.get(0))
        .optional()?;
    if puede == Some(true) {
        Ok(())
    } else {
        Err(ErrorApp::nuevo("PERMISO_DENEGADO", "No tienes permiso para registrar ingresos. Pídeselo al Jefe del gimnasio."))
    }
}

fn tiene_pase_dia(conn: &Connection, deportista_id: &str, hoy: NaiveDate) -> Resultado<bool> {
    let mut stmt = conn.prepare("SELECT created_at FROM pases_dia WHERE deportista_id = ?1 AND anulada = 0")?;
    let fechas = stmt.query_map([deportista_id], |f| f.get::<_, String>(0))?;
    for texto in fechas {
        if let Ok(instante) = texto?.parse::<DateTime<Utc>>() {
            if fecha_negocio(instante) == hoy {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Estado de acceso de un cliente para el día `hoy`. `None` si no existe o fue eliminado.
pub fn evaluar_cliente(conn: &Connection, deportista_id: &str, hoy: NaiveDate) -> Resultado<Option<ClienteEvaluado>> {
    let Some((id, nombre, tipo_documento, documento, activo)) = conn
        .query_row(
            "SELECT id, nombre, tipo_documento, documento, activo FROM deportistas WHERE id = ?1 AND eliminado = 0",
            [deportista_id],
            |f| Ok((f.get::<_, String>(0)?, f.get::<_, String>(1)?, f.get::<_, Option<String>>(2)?, f.get::<_, String>(3)?, f.get::<_, bool>(4)?)),
        )
        .optional()?
    else {
        return Ok(None);
    };
    let (dias_gracia_mora, dias_umbral_por_vencer): (i64, i64) = conn
        .query_row("SELECT dias_gracia_mora, dias_umbral_por_vencer FROM gimnasio LIMIT 1", [], |f| Ok((f.get(0)?, f.get(1)?)))
        .optional()?
        .ok_or_else(error_sin_datos)?;

    // La más reciente sin cancelar: mismo orden que el servidor.
    let membresia: Option<(String, String, Option<String>)> = conn
        .query_row(
            "SELECT m.id, m.fecha_vencimiento, p.nombre
             FROM membresias m LEFT JOIN planes p ON p.id = m.plan_id
             WHERE m.deportista_id = ?1 AND m.cancelada = 0
             ORDER BY m.fecha_vencimiento DESC, m.created_at DESC LIMIT 1",
            [&id],
            |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?)),
        )
        .optional()?;

    let mut entrada = Entrada {
        hoy,
        activo,
        tiene_membresia: false,
        ultima_cancelada: false,
        fecha_vencimiento: None,
        congelamiento_activo: false,
        dias_gracia_mora,
        dias_umbral_por_vencer,
    };
    let (mut plan_nombre, mut vencimiento_texto) = (None, None);
    match membresia {
        Some((membresia_id, vencimiento, plan)) => {
            let fecha: NaiveDate = vencimiento
                .parse()
                .map_err(|_| ErrorApp::nuevo("DATOS_LOCALES_INVALIDOS", "Hay una membresía con una fecha que GymDesk no entiende. Sincroniza de nuevo."))?;
            entrada.tiene_membresia = true;
            entrada.fecha_vencimiento = Some(fecha);
            entrada.congelamiento_activo = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM congelamientos
                               WHERE membresia_id = ?1 AND fecha_inicio <= ?2 AND (fecha_fin IS NULL OR fecha_fin > ?2))",
                params![membresia_id, hoy.to_string()],
                |f| f.get(0),
            )?;
            plan_nombre = plan;
            vencimiento_texto = Some(vencimiento);
        }
        None => {
            entrada.ultima_cancelada = conn
                .query_row(
                    "SELECT cancelada FROM membresias WHERE deportista_id = ?1 ORDER BY fecha_vencimiento DESC, created_at DESC LIMIT 1",
                    [&id],
                    |f| f.get::<_, bool>(0),
                )
                .optional()?
                .unwrap_or(false);
        }
    }

    let e = regla::evaluar(&entrada);
    let (mut abre, mut resultado, mut mensaje, mut con_pase_dia) = (e.permite_ingreso, e.resultado_acceso, e.mensaje, false);
    // Un pase de día pagado hoy deja entrar hoy, aunque no haya membresía al día.
    // A quien el gimnasio desactivó se le sigue negando.
    if resultado != "abrio" && activo && tiene_pase_dia(conn, &id, hoy)? {
        abre = true;
        resultado = "abrio";
        mensaje = "Ingreso con pase de día vigente hoy.".into();
        con_pase_dia = true;
    }
    Ok(Some(ClienteEvaluado {
        id,
        nombre,
        tipo_documento,
        documento,
        plan_nombre,
        fecha_vencimiento: vencimiento_texto,
        estado: e.estado,
        dias_restantes_o_vencido: e.dias_restantes_o_vencido,
        con_pase_dia,
        abre,
        resultado,
        mensaje,
    }))
}

/// Minúsculas y sin tildes, para que "jose" encuentre a "José".
fn plano(texto: &str) -> String {
    texto
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' => 'a',
            'é' | 'è' | 'ë' => 'e',
            'í' | 'ì' | 'ï' => 'i',
            'ó' | 'ò' | 'ö' => 'o',
            'ú' | 'ù' | 'ü' => 'u',
            'ñ' => 'n',
            otro => otro,
        })
        .collect()
}

/// Busca por nombre o documento. El documento exacto va primero.
pub fn buscar(conn: &Connection, texto: &str, hoy: NaiveDate) -> Resultado<Vec<ClienteEvaluado>> {
    let buscado = plano(texto.trim());
    if buscado.chars().count() < 2 {
        return Ok(vec![]);
    }
    let palabras: Vec<&str> = buscado.split_whitespace().collect();
    let mut exactos = Vec::new();
    let mut parciales = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT id, nombre, documento FROM deportistas WHERE eliminado = 0")?;
        let filas = stmt.query_map([], |f| Ok((f.get::<_, String>(0)?, f.get::<_, String>(1)?, f.get::<_, String>(2)?)))?;
        for fila in filas {
            let (id, nombre, documento) = fila?;
            let (documento, nombre) = (plano(&documento), plano(&nombre));
            if documento == buscado {
                exactos.push(id);
            } else if documento.starts_with(&buscado) || palabras.iter().all(|p| nombre.contains(p)) {
                parciales.push((nombre, id));
            }
        }
    }
    // Orden alfabético sin tildes: el de SQLite pondría "Josefina" antes que "José".
    parciales.sort();
    let parciales = parciales.into_iter().map(|(_, id)| id);
    let mut resultado = Vec::new();
    for id in exactos.into_iter().chain(parciales).take(MAX_RESULTADOS_BUSQUEDA) {
        if let Some(c) = evaluar_cliente(conn, &id, hoy)? {
            resultado.push(c);
        }
    }
    Ok(resultado)
}

pub enum Objetivo<'a> {
    Id(&'a str),
    /// Lo que escribió recepción o leyó el lector de códigos: el número de documento.
    Documento(&'a str),
}

/// Registra un intento de ingreso. Devuelve qué mostrar y si se abre la puerta.
pub fn registrar_ingreso(
    conn: &Connection,
    ahora: DateTime<Utc>,
    usuario: &UsuarioSesion,
    objetivo: Objetivo<'_>,
    metodo: &str,
) -> Resultado<ResultadoIngreso> {
    exigir_permiso_ingreso(conn, usuario)?;
    if !matches!(metodo, "manual" | "huella") {
        return Err(ErrorApp::nuevo("DATOS_INVALIDOS", "Método de ingreso desconocido."));
    }
    let deportista_id: String = match objetivo {
        Objetivo::Id(id) => id.to_string(),
        Objetivo::Documento(doc) => conn
            .query_row("SELECT id FROM deportistas WHERE documento = ?1 AND eliminado = 0", [doc.trim()], |f| f.get(0))
            .optional()?
            .ok_or_else(error_no_encontrado)?,
    };
    let cliente = evaluar_cliente(conn, &deportista_id, fecha_negocio(ahora))?.ok_or_else(error_no_encontrado)?;
    let ts = a_texto(ahora);

    let previo: Option<String> = conn
        .query_row(
            "SELECT resultado FROM ingresos
             WHERE deportista_id = ?1 AND ocurrido_en > ?2 AND ocurrido_en <= ?3
             ORDER BY ocurrido_en DESC LIMIT 1",
            params![cliente.id, a_texto(ahora - Duration::seconds(ANTIRREBOTE_SEGUNDOS)), ts],
            |f| f.get(0),
        )
        .optional()?;
    if let Some(resultado) = previo {
        return Ok(ResultadoIngreso {
            id: None,
            tipo: "ingreso",
            relectura_ignorada: true,
            abre: false,
            resultado,
            mensaje: "Relectura ignorada dentro del intervalo de 3 segundos".into(),
            cliente: Some(cliente),
            ocurrido_en: ts,
        });
    }

    let tx = conn.unchecked_transaction()?;
    let id = outbox::encolar(
        &tx,
        ahora,
        "ingreso",
        Some(&usuario.id),
        &[],
        &json!({
            "deportista_id": cliente.id, "metodo": metodo, "resultado": cliente.resultado,
            "estado": cliente.estado, "con_pase_dia": cliente.con_pase_dia,
        }),
    )?;
    tx.execute(
        "INSERT INTO ingresos (id, tipo, deportista_id, deportista_nombre, metodo, resultado, estado, con_pase_dia, mensaje,
                               staff_id, ocurrido_en, fecha_negocio)
         VALUES (?1, 'ingreso', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id, cliente.id, cliente.nombre, metodo, cliente.resultado, cliente.estado, cliente.con_pase_dia, cliente.mensaje,
            usuario.id, ts, fecha_negocio(ahora).to_string(),
        ],
    )?;
    tx.commit()?;

    Ok(ResultadoIngreso {
        id: Some(id),
        tipo: "ingreso",
        relectura_ignorada: false,
        abre: cliente.abre,
        resultado: cliente.resultado.to_string(),
        mensaje: cliente.mensaje.clone(),
        cliente: Some(cliente),
        ocurrido_en: ts,
    })
}

/// Ingreso de cortesía: sin cliente, con motivo obligatorio, y queda en la auditoría.
pub fn registrar_cortesia(conn: &Connection, ahora: DateTime<Utc>, usuario: &UsuarioSesion, motivo: &str) -> Resultado<ResultadoIngreso> {
    exigir_permiso_ingreso(conn, usuario)?;
    let motivo = motivo.trim();
    if motivo.chars().count() < MOTIVO_MINIMO {
        return Err(ErrorApp::nuevo("MOTIVO_REQUERIDO", "Escribe el motivo de la cortesía (mínimo 4 letras)."));
    }
    if motivo.chars().count() > 255 {
        return Err(ErrorApp::nuevo("MOTIVO_MUY_LARGO", "El motivo no puede pasar de 255 letras."));
    }
    let ts = a_texto(ahora);
    let mensaje = "Ingreso de cortesía concedido.";

    let tx = conn.unchecked_transaction()?;
    let id = outbox::encolar(&tx, ahora, "cortesia", Some(&usuario.id), &[], &json!({ "motivo": motivo }))?;
    tx.execute(
        "INSERT INTO ingresos (id, tipo, metodo, resultado, mensaje, motivo_cortesia, staff_id, ocurrido_en, fecha_negocio)
         VALUES (?1, 'cortesia', 'manual', 'abrio', ?2, ?3, ?4, ?5, ?6)",
        params![id, mensaje, motivo, usuario.id, ts, fecha_negocio(ahora).to_string()],
    )?;
    auditoria::registrar(
        &tx,
        ahora,
        Actor::persona(&usuario.id, &usuario.nombre),
        "INGRESO_CORTESIA",
        "ingresos",
        Some(&id),
        &json!({ "motivo": motivo }),
    )?;
    tx.commit()?;

    Ok(ResultadoIngreso {
        id: Some(id),
        tipo: "cortesia",
        relectura_ignorada: false,
        abre: true,
        resultado: "abrio".into(),
        mensaje: mensaje.into(),
        cliente: None,
        ocurrido_en: ts,
    })
}

#[derive(Debug, Serialize)]
pub struct IngresoListado {
    pub id: String,
    pub tipo: String,
    pub deportista_nombre: Option<String>,
    pub resultado: String,
    pub estado: Option<String>,
    pub mensaje: String,
    pub motivo_cortesia: Option<String>,
    pub ocurrido_en: String,
    /// Estado de su operación en la cola: pendiente, aplicada, pendiente_revision, error…
    pub envio: String,
}

#[derive(Debug, Serialize)]
pub struct ResumenIngresos {
    pub fecha: String,
    pub total: i64,
    pub abrieron: i64,
    pub alertas: i64,
    pub negados: i64,
    pub cortesias: i64,
    /// Los más recientes primero.
    pub items: Vec<IngresoListado>,
    /// El reloj del equipo marca una hora anterior a la del último registro: alguien lo cambió.
    pub reloj_retrocedio: bool,
}

/// El reloj del equipo va más de un minuto por detrás de lo último que esta estación registró.
pub fn reloj_retrocedio(conn: &Connection, ahora: DateTime<Utc>) -> Resultado<bool> {
    let ultimo: Option<String> = conn.query_row("SELECT max(ocurrida_en) FROM sync_outbox", [], |f| f.get(0))?;
    Ok(ultimo.is_some_and(|u| u > a_texto(ahora + Duration::seconds(60))))
}

/// Lo que esta estación registró hoy (día de Bogotá).
pub fn ingresos_del_dia(conn: &Connection, ahora: DateTime<Utc>) -> Resultado<ResumenIngresos> {
    let hoy = fecha_negocio(ahora).to_string();
    let (total, abrieron, alertas, negados, cortesias) = conn.query_row(
        "SELECT count(*),
                coalesce(sum(tipo = 'ingreso' AND resultado = 'abrio'), 0),
                coalesce(sum(tipo = 'ingreso' AND resultado = 'alerta_mora'), 0),
                coalesce(sum(tipo = 'ingreso' AND resultado = 'negado'), 0),
                coalesce(sum(tipo = 'cortesia'), 0)
         FROM ingresos WHERE fecha_negocio = ?1",
        [&hoy],
        |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?, f.get(4)?)),
    )?;
    let items = {
        let mut stmt = conn.prepare(
            "SELECT i.id, i.tipo, i.deportista_nombre, i.resultado, i.estado, i.mensaje, i.motivo_cortesia, i.ocurrido_en, o.estado
             FROM ingresos i JOIN sync_outbox o ON o.id = i.id
             WHERE i.fecha_negocio = ?1 ORDER BY i.ocurrido_en DESC, o.secuencia DESC LIMIT ?2",
        )?;
        let filas = stmt.query_map(params![hoy, MAX_INGRESOS_LISTADOS], |f| {
            Ok(IngresoListado {
                id: f.get(0)?,
                tipo: f.get(1)?,
                deportista_nombre: f.get(2)?,
                resultado: f.get(3)?,
                estado: f.get(4)?,
                mensaje: f.get(5)?,
                motivo_cortesia: f.get(6)?,
                ocurrido_en: f.get(7)?,
                envio: f.get(8)?,
            })
        })?;
        filas.collect::<Result<Vec<_>, _>>()?
    };
    Ok(ResumenIngresos { fecha: hoy, total, abrieron, alertas, negados, cortesias, items, reloj_retrocedio: reloj_retrocedio(conn, ahora)? })
}
