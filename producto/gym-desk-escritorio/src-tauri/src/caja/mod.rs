//! Caja de la estación (fase 3A): turno con arqueo, venta de mostrador, egresos y cierre diario.
//!
//! Todo se decide y se guarda en la base local, con red o sin ella; cada turno, venta y egreso se
//! escribe en la misma transacción que su operación en la cola y usa el id de esa operación, que es
//! el mismo que guarda el servidor. El efectivo esperado se calcula igual que en el servidor
//! (`CajaService._calcular_acumulados_turno`): base + efectivo cobrado (también la parte en efectivo de
//! un pago mixto) − egresos. Montos en pesos colombianos enteros.

use std::collections::BTreeMap;

use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::auditoria::{self, Actor};
use crate::error::{ErrorApp, Resultado};
use crate::reloj::{a_texto, fecha_negocio};
use crate::sesion::UsuarioSesion;
use crate::sync::outbox;

pub mod membresias;
#[cfg(test)]
mod pruebas;
#[cfg(test)]
mod pruebas_membresias;
#[cfg(test)]
mod prueba_dia_sin_red;

/// Más que esto en un solo movimiento es un error de digitación (mismo tope que el servidor).
pub const MAX_MONTO: i64 = 100_000_000;
const MOTIVO_MINIMO: usize = 4;
const MAX_ITEMS: usize = 50;
/// Estados de la cola en los que una venta todavía no está en el servidor.
const SIN_SUBIR: &str = "('pendiente','enviando','retenida','error')";

/// Un medio es efectivo solo si se llama así; todo lo demás (Nequi, datáfono…) es "otro" (igual que la web).
pub fn tipo_medio_de(metodo: &str) -> &'static str {
    if metodo.trim().to_lowercase() == "efectivo" {
        "efectivo"
    } else {
        "otro"
    }
}

fn error(codigo: &str, mensaje: &str) -> ErrorApp {
    ErrorApp::nuevo(codigo, mensaje)
}

/// Permiso de caja del rol según lo descargado. El Jefe lo tiene todo; sin fila de permiso, no (se cierra).
fn tiene_permiso(conn: &Connection, usuario: &UsuarioSesion, columna: &str) -> Resultado<bool> {
    if usuario.rol == "jefe" {
        return Ok(true);
    }
    let columna = match columna {
        "editar" => "puede_editar",
        _ => "puede_crear",
    };
    let puede: Option<bool> = conn
        .query_row(&format!("SELECT {columna} FROM permisos_rol WHERE rol = ?1 AND submodulo = 'caja'"), [&usuario.rol], |f| f.get(0))
        .optional()?;
    Ok(puede == Some(true))
}

pub fn exigir_permiso_caja(conn: &Connection, usuario: &UsuarioSesion) -> Resultado<()> {
    if tiene_permiso(conn, usuario, "crear")? {
        Ok(())
    } else {
        Err(error("PERMISO_DENEGADO", "No tienes permiso de caja. Pídeselo al Jefe del gimnasio."))
    }
}

// ---------------------------------------------------------------------------
// Turno
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TurnoLocal {
    pub id: String,
    pub staff_id: String,
    pub abierto_por_nombre: Option<String>,
    pub base_inicial: i64,
    pub abierto_en: String,
    pub fecha_negocio: String,
    pub sin_confirmar: bool,
    pub estado: String,
    pub cerrado_en: Option<String>,
    pub cerrado_por_nombre: Option<String>,
    pub efectivo_contado: Option<i64>,
    pub total_esperado_efectivo: Option<i64>,
    pub diferencia: Option<i64>,
    pub nota_cierre: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PorMetodo {
    pub metodo: String,
    pub tipo_medio: String,
    pub monto: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Totales {
    pub base_inicial: i64,
    pub ventas_efectivo: i64,
    pub ventas_otro: i64,
    /// Ventas y renovaciones de membresía (fase 3B).
    pub membresias_efectivo: i64,
    pub membresias_otro: i64,
    pub egresos_efectivo: i64,
    pub total_esperado_efectivo: i64,
    pub num_ventas: i64,
    pub num_membresias: i64,
    pub num_egresos: i64,
    pub por_metodo: Vec<PorMetodo>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ResumenTurno {
    pub turno: TurnoLocal,
    pub totales: Totales,
}

const SELECT_TURNO: &str = "SELECT t.id, t.staff_id, s.nombre, t.base_inicial, t.abierto_en, t.fecha_negocio, t.sin_confirmar, t.estado,
       t.cerrado_en, c.nombre, t.efectivo_contado, t.total_esperado_efectivo, t.diferencia, t.nota_cierre
     FROM caja_turnos t LEFT JOIN staff_local s ON s.id = t.staff_id LEFT JOIN staff_local c ON c.id = t.cerrado_por";

fn fila_turno(f: &rusqlite::Row<'_>) -> rusqlite::Result<TurnoLocal> {
    Ok(TurnoLocal {
        id: f.get(0)?,
        staff_id: f.get(1)?,
        abierto_por_nombre: f.get(2)?,
        base_inicial: f.get(3)?,
        abierto_en: f.get(4)?,
        fecha_negocio: f.get(5)?,
        sin_confirmar: f.get(6)?,
        estado: f.get(7)?,
        cerrado_en: f.get(8)?,
        cerrado_por_nombre: f.get(9)?,
        efectivo_contado: f.get(10)?,
        total_esperado_efectivo: f.get(11)?,
        diferencia: f.get(12)?,
        nota_cierre: f.get(13)?,
    })
}

pub fn turno_abierto(conn: &Connection) -> Resultado<Option<TurnoLocal>> {
    Ok(conn.query_row(&format!("{SELECT_TURNO} WHERE t.estado = 'abierto'"), [], fila_turno).optional()?)
}

fn turno_por_id(conn: &Connection, id: &str) -> Resultado<TurnoLocal> {
    conn.query_row(&format!("{SELECT_TURNO} WHERE t.id = ?1"), [id], fila_turno)
        .optional()?
        .ok_or_else(|| error("TURNO_NO_ENCONTRADO", "Ese turno de caja no existe en esta estación."))
}

fn exigir_turno_abierto(conn: &Connection) -> Resultado<TurnoLocal> {
    turno_abierto(conn)?.ok_or_else(|| error("NO_HAY_TURNO_ABIERTO", "Abre la caja antes de cobrar o registrar egresos."))
}

/// Totales de un turno, igual que los calcula el servidor.
pub fn totales(conn: &Connection, turno_id: &str) -> Resultado<Totales> {
    let base: i64 = conn.query_row("SELECT base_inicial FROM caja_turnos WHERE id = ?1", [turno_id], |f| f.get(0))?;
    let (num_ventas, num_membresias, num_egresos, egresos): (i64, i64, i64, i64) = conn.query_row(
        "SELECT (SELECT count(*) FROM caja_ventas WHERE turno_id = ?1),
                (SELECT count(*) FROM caja_pagos_membresia WHERE turno_id = ?1),
                (SELECT count(*) FROM caja_egresos WHERE turno_id = ?1),
                (SELECT coalesce(sum(monto), 0) FROM caja_egresos WHERE turno_id = ?1)",
        [turno_id],
        |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?)),
    )?;
    // Cada peso con su medio: el cobro de un solo medio, o cada parte de un pago mixto.
    // La primera columna dice de dónde viene: 'v' venta de mostrador, 'm' membresía.
    let mut por_metodo: BTreeMap<(String, String), i64> = BTreeMap::new();
    let (mut ventas_efectivo, mut ventas_otro, mut membresias_efectivo, mut membresias_otro) = (0, 0, 0, 0);
    {
        let mut stmt = conn.prepare(
            "SELECT 'v', metodo, tipo_medio, total FROM caja_ventas WHERE turno_id = ?1 AND tipo_medio <> 'mixto'
             UNION ALL
             SELECT 'v', m.metodo, m.tipo_medio, m.monto FROM caja_venta_medios m JOIN caja_ventas v ON v.id = m.venta_id WHERE v.turno_id = ?1
             UNION ALL
             SELECT 'm', metodo, tipo_medio, precio_cobrado FROM caja_pagos_membresia WHERE turno_id = ?1 AND tipo_medio <> 'mixto'
             UNION ALL
             SELECT 'm', m.metodo, m.tipo_medio, m.monto FROM caja_pago_membresia_medios m JOIN caja_pagos_membresia p ON p.id = m.pago_id
             WHERE p.turno_id = ?1",
        )?;
        let filas = stmt.query_map([turno_id], |f| {
            Ok((f.get::<_, String>(0)?, f.get::<_, String>(1)?, f.get::<_, String>(2)?, f.get::<_, i64>(3)?))
        })?;
        for fila in filas {
            let (origen, metodo, tipo, monto) = fila?;
            match (origen.as_str(), tipo.as_str()) {
                ("v", "efectivo") => ventas_efectivo += monto,
                ("v", _) => ventas_otro += monto,
                (_, "efectivo") => membresias_efectivo += monto,
                _ => membresias_otro += monto,
            }
            *por_metodo.entry((metodo, tipo)).or_default() += monto;
        }
    }
    let mut por_metodo: Vec<PorMetodo> =
        por_metodo.into_iter().map(|((metodo, tipo_medio), monto)| PorMetodo { metodo, tipo_medio, monto }).collect();
    por_metodo.sort_by(|a, b| b.monto.cmp(&a.monto).then(a.metodo.cmp(&b.metodo)));
    Ok(Totales {
        base_inicial: base,
        ventas_efectivo,
        ventas_otro,
        membresias_efectivo,
        membresias_otro,
        egresos_efectivo: egresos,
        total_esperado_efectivo: base + ventas_efectivo + membresias_efectivo - egresos,
        num_ventas,
        num_membresias,
        num_egresos,
        por_metodo,
    })
}

pub fn resumen(conn: &Connection, turno_id: &str) -> Resultado<ResumenTurno> {
    Ok(ResumenTurno { turno: turno_por_id(conn, turno_id)?, totales: totales(conn, turno_id)? })
}

/// Cómo quedó la regla de turno único al abrir (A1).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Confirmacion {
    /// Con red: el servidor confirmó que no había otro turno abierto en el gimnasio.
    Confirmada,
    /// Sin red: no se pudo confirmar. Se abre igual y se avisa.
    SinRed,
}

fn monto_valido(valor: i64, campo: &str) -> Resultado<()> {
    if (0..=MAX_MONTO).contains(&valor) {
        Ok(())
    } else {
        Err(error("MONTO_INVALIDO", &format!("Revisa {campo}: debe ser un valor entre 0 y 100.000.000.")))
    }
}

pub fn abrir_turno(
    conn: &Connection,
    ahora: DateTime<Utc>,
    usuario: &UsuarioSesion,
    base_inicial: i64,
    confirmacion: Confirmacion,
) -> Resultado<ResumenTurno> {
    exigir_permiso_caja(conn, usuario)?;
    monto_valido(base_inicial, "la base inicial")?;
    if turno_abierto(conn)?.is_some() {
        return Err(error("TURNO_YA_ABIERTO", "Ya hay un turno de caja abierto en esta estación."));
    }
    let sin_confirmar = confirmacion == Confirmacion::SinRed;
    let ts = a_texto(ahora);
    let tx = conn.unchecked_transaction()?;
    let id = outbox::encolar(
        &tx,
        ahora,
        "turno_abrir",
        Some(&usuario.id),
        &[],
        &json!({ "base_inicial": base_inicial, "sin_confirmar": sin_confirmar }),
    )?;
    tx.execute(
        "INSERT INTO caja_turnos (id, staff_id, base_inicial, abierto_en, fecha_negocio, sin_confirmar) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, usuario.id, base_inicial, ts, fecha_negocio(ahora).to_string(), sin_confirmar],
    )?;
    auditoria::registrar(
        &tx,
        ahora,
        Actor::persona(&usuario.id, &usuario.nombre),
        "ABRIR_TURNO_CAJA",
        "caja_turnos",
        Some(&id),
        &json!({ "base_inicial": base_inicial, "sin_confirmar": sin_confirmar }),
    )?;
    tx.commit()?;
    resumen(conn, &id)
}

pub fn cerrar_turno(
    conn: &Connection,
    ahora: DateTime<Utc>,
    usuario: &UsuarioSesion,
    efectivo_contado: i64,
    nota: Option<&str>,
) -> Resultado<ResumenTurno> {
    exigir_permiso_caja(conn, usuario)?;
    monto_valido(efectivo_contado, "el efectivo contado")?;
    let turno = exigir_turno_abierto(conn)?;
    let nota = nota.map(str::trim).filter(|n| !n.is_empty());
    if nota.is_some_and(|n| n.chars().count() > 500) {
        return Err(error("NOTA_MUY_LARGA", "La nota no puede pasar de 500 letras."));
    }
    let esperado = totales(conn, &turno.id)?.total_esperado_efectivo;
    let diferencia = efectivo_contado - esperado;
    let tx = conn.unchecked_transaction()?;
    outbox::encolar(
        &tx,
        ahora,
        "turno_cerrar",
        Some(&usuario.id),
        std::slice::from_ref(&turno.id),
        &json!({ "turno_id": turno.id, "efectivo_contado": efectivo_contado, "total_esperado_efectivo": esperado, "nota": nota }),
    )?;
    tx.execute(
        "UPDATE caja_turnos SET estado = 'cerrado', cerrado_en = ?1, cerrado_por = ?2, efectivo_contado = ?3,
           total_esperado_efectivo = ?4, diferencia = ?5, nota_cierre = ?6
         WHERE id = ?7 AND estado = 'abierto'",
        params![a_texto(ahora), usuario.id, efectivo_contado, esperado, diferencia, nota, turno.id],
    )?;
    auditoria::registrar(
        &tx,
        ahora,
        Actor::persona(&usuario.id, &usuario.nombre),
        "CERRAR_TURNO_CAJA",
        "caja_turnos",
        Some(&turno.id),
        &json!({ "total_esperado_efectivo": esperado, "efectivo_contado": efectivo_contado, "diferencia": diferencia }),
    )?;
    tx.commit()?;
    resumen(conn, &turno.id)
}

// ---------------------------------------------------------------------------
// Mostrador
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, Serialize)]
pub struct DatosMostrador {
    /// Medios configurados por el gimnasio; si no hay, "Efectivo" y "Otro medio" (igual que la web).
    pub metodos_pago: Vec<String>,
    pub precio_pase_dia: Option<i64>,
    pub precio_pase_clase: Option<i64>,
    pub permitir_descuentos: bool,
    pub tope_descuento_pct: i64,
    pub puede_descontar: bool,
    pub puede_operar: bool,
}

struct Gimnasio {
    permitir_descuentos: bool,
    tope_descuento_pct: i64,
    precio_pase_dia: Option<i64>,
    precio_pase_clase: Option<i64>,
    metodos_pago: String,
}

fn gimnasio(conn: &Connection) -> Resultado<Gimnasio> {
    conn.query_row(
        "SELECT permitir_descuentos, tope_descuento_pct, precio_pase_dia, precio_pase_clase, metodos_pago FROM gimnasio LIMIT 1",
        [],
        |f| {
            Ok(Gimnasio {
                permitir_descuentos: f.get(0)?,
                tope_descuento_pct: f.get(1)?,
                precio_pase_dia: f.get(2)?,
                precio_pase_clase: f.get(3)?,
                metodos_pago: f.get(4)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| error("DATOS_SIN_DESCARGAR", "Esta estación aún no ha descargado los datos del gimnasio. Conéctala a internet."))
}

pub fn datos_mostrador(conn: &Connection, usuario: &UsuarioSesion) -> Resultado<DatosMostrador> {
    let g = gimnasio(conn)?;
    let mut metodos: Vec<String> = serde_json::from_str::<Vec<String>>(&g.metodos_pago).unwrap_or_default();
    metodos.retain(|m| !m.trim().is_empty());
    if metodos.is_empty() {
        metodos = vec!["Efectivo".into(), "Otro medio".into()];
    }
    Ok(DatosMostrador {
        metodos_pago: metodos,
        precio_pase_dia: g.precio_pase_dia,
        precio_pase_clase: g.precio_pase_clase,
        permitir_descuentos: g.permitir_descuentos,
        tope_descuento_pct: g.tope_descuento_pct,
        puede_descontar: g.permitir_descuentos && tiene_permiso(conn, usuario, "editar")?,
        puede_operar: tiene_permiso(conn, usuario, "crear")?,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ProductoVenta {
    pub id: String,
    pub nombre: String,
    pub precio: i64,
    /// Stock del servidor menos lo vendido aquí que aún no ha subido.
    pub disponible: i64,
}

fn sql_disponible(alias: &str) -> String {
    format!(
        "{alias}.stock - coalesce((SELECT sum(i.cantidad) FROM caja_venta_items i JOIN sync_outbox o ON o.id = i.venta_id
                                   WHERE i.producto_id = {alias}.id AND o.estado IN {SIN_SUBIR}), 0)"
    )
}

/// Productos activos para vender, por nombre. Sin texto, todos (hasta 60).
pub fn productos_para_venta(conn: &Connection, texto: &str) -> Resultado<Vec<ProductoVenta>> {
    let buscado = crate::acceso::registro::plano(texto.trim());
    let mut stmt = conn.prepare(&format!(
        "SELECT p.id, p.nombre, p.precio, {} FROM productos p WHERE p.activo = 1 ORDER BY p.nombre",
        sql_disponible("p")
    ))?;
    let filas = stmt.query_map([], |f| {
        Ok(ProductoVenta { id: f.get(0)?, nombre: f.get(1)?, precio: f.get(2)?, disponible: f.get(3)? })
    })?;
    let mut lista = Vec::new();
    for p in filas {
        let p = p?;
        if buscado.is_empty() || crate::acceso::registro::plano(&p.nombre).contains(&buscado) {
            lista.push(p);
        }
        if lista.len() >= 60 {
            break;
        }
    }
    Ok(lista)
}

#[derive(Debug, Clone, Deserialize)]
pub struct NuevoItem {
    /// producto | pase_dia | pase_clase
    pub tipo: String,
    pub producto_id: Option<String>,
    pub cantidad: i64,
    /// Precio de un pase cuando el gimnasio no lo tiene configurado.
    pub precio: Option<i64>,
    /// Si es menor que el de lista, es un descuento: exige permiso, motivo y respetar el tope.
    pub precio_cobrado: Option<i64>,
    pub motivo_descuento: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NuevoMedio {
    pub metodo: String,
    pub monto: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NuevaVenta {
    pub deportista_id: Option<String>,
    pub items: Vec<NuevoItem>,
    /// Medio de pago cuando es uno solo.
    pub metodo: Option<String>,
    /// Pago mixto: el reparto entre dos o más medios.
    pub pagos: Option<Vec<NuevoMedio>>,
    pub valor_recibido: Option<i64>,
    /// Lo que anota quien cobra (opcional, hasta 300 letras).
    #[serde(default)]
    pub nota: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ItemVendido {
    pub tipo: String,
    pub producto_id: Option<String>,
    pub descripcion: String,
    pub cantidad: i64,
    pub precio_lista: i64,
    pub precio_cobrado: i64,
    pub subtotal: i64,
    pub motivo_descuento: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct VentaRegistrada {
    pub id: String,
    pub turno_id: String,
    pub deportista_nombre: Option<String>,
    pub items: Vec<ItemVendido>,
    pub total: i64,
    pub tipo_medio: String,
    pub metodo: String,
    pub pagos: Vec<PorMetodo>,
    pub valor_recibido: Option<i64>,
    pub cambio: Option<i64>,
    pub ocurrida_en: String,
}

/// Porcentaje de descuento con dos decimales, multiplicado por 100 (el servidor usa round(x, 2)).
fn descuento_centesimas(lista: i64, cobrado: i64) -> i64 {
    if lista <= 0 || cobrado >= lista {
        return 0;
    }
    // La mitad se redondea hacia arriba: en el borde exacto la estación es más estricta que el
    // servidor (que redondea al par), así que nunca deja pasar algo que él marcaría.
    ((lista - cobrado) * 10_000 * 2 + lista) / (lista * 2)
}

/// Regla de descuento de la web (GW-RF-53) con lo descargado. Devuelve el motivo si hay descuento.
fn validar_descuento(g: &Gimnasio, puede_descontar: bool, lista: i64, cobrado: i64, motivo: Option<&str>) -> Resultado<Option<String>> {
    if cobrado >= lista {
        return Ok(None);
    }
    if !g.permitir_descuentos {
        return Err(error("DESCUENTOS_DESHABILITADOS", "Los descuentos están deshabilitados en este gimnasio."));
    }
    if !puede_descontar {
        return Err(error("SIN_PERMISO_DESCUENTO", "No tienes permiso para dar descuentos en caja."));
    }
    let m = motivo.map(str::trim).unwrap_or("");
    if m.chars().count() < MOTIVO_MINIMO {
        return Err(error("MOTIVO_DESCUENTO_REQUERIDO", "Escribe el motivo del descuento (mínimo 4 letras)."));
    }
    if m.chars().count() > 255 {
        return Err(error("MOTIVO_MUY_LARGO", "El motivo no puede pasar de 255 letras."));
    }
    if descuento_centesimas(lista, cobrado) > g.tope_descuento_pct * 100 {
        return Err(ErrorApp::con_detalles(
            "DESCUENTO_SUPERA_TOPE",
            &format!("El descuento supera el tope del gimnasio ({} %).", g.tope_descuento_pct),
            json!({ "tope_pct": g.tope_descuento_pct }),
        ));
    }
    Ok(Some(m.to_string()))
}

/// Cómo se pagó un cobro: un medio, o el reparto de un pago mixto, y el cambio del efectivo.
struct Cobro {
    tipo_medio: String,
    metodo: String,
    pagos: Vec<PorMetodo>,
    valor_recibido: Option<i64>,
    cambio: Option<i64>,
}

/// Nota opcional de un cobro: sin espacios sobrantes y hasta 300 letras.
pub(crate) fn validar_nota(nota: Option<&str>) -> Resultado<Option<String>> {
    let nota = nota.map(str::trim).filter(|n| !n.is_empty());
    if nota.is_some_and(|n| n.chars().count() > 300) {
        return Err(error("NOTA_MUY_LARGA", "La nota no puede pasar de 300 letras."));
    }
    Ok(nota.map(str::to_string))
}

fn resolver_cobro(metodo: Option<&str>, pagos: Option<&[NuevoMedio]>, total: i64, valor_recibido: Option<i64>) -> Resultado<Cobro> {
    let (tipo_medio, metodo, pagos): (String, String, Vec<PorMetodo>) = match pagos.filter(|p| !p.is_empty()) {
        Some(pagos) => {
            if pagos.len() < 2 || pagos.len() > 5 {
                return Err(error("MEDIOS_INVALIDOS", "Un pago mixto se reparte entre 2 y 5 medios."));
            }
            let mut lista = Vec::new();
            for p in pagos {
                if p.metodo.trim().chars().count() < 2 || p.monto <= 0 {
                    return Err(error("MEDIOS_INVALIDOS", "Cada medio del pago mixto necesita su nombre y un valor mayor que cero."));
                }
                lista.push(PorMetodo { metodo: p.metodo.trim().to_string(), tipo_medio: tipo_medio_de(&p.metodo).into(), monto: p.monto });
            }
            let suma: i64 = lista.iter().map(|p| p.monto).sum();
            if suma != total {
                return Err(error("MEDIOS_NO_SUMAN_TOTAL", "Los medios de pago no suman el total a cobrar."));
            }
            ("mixto".into(), "mixto".into(), lista)
        }
        None => {
            let metodo = metodo.map(str::trim).filter(|m| m.chars().count() >= 2).ok_or_else(|| {
                error("METODO_REQUERIDO", "Elige el medio de pago.")
            })?;
            (tipo_medio_de(metodo).into(), metodo.to_string(), vec![])
        }
    };
    let en_efectivo = if tipo_medio == "mixto" {
        pagos.iter().filter(|p| p.tipo_medio == "efectivo").map(|p| p.monto).sum()
    } else if tipo_medio == "efectivo" {
        total
    } else {
        0
    };
    let valor_recibido = valor_recibido.filter(|_| en_efectivo > 0);
    let cambio = match valor_recibido {
        Some(v) if v < en_efectivo => {
            return Err(error("PAGO_INSUFICIENTE", "El efectivo recibido es menor que lo que se cobra en efectivo."))
        }
        Some(v) => {
            monto_valido(v, "el efectivo recibido")?;
            Some(v - en_efectivo)
        }
        None => None,
    };
    Ok(Cobro { tipo_medio, metodo, pagos, valor_recibido, cambio })
}

pub fn registrar_venta(conn: &Connection, ahora: DateTime<Utc>, usuario: &UsuarioSesion, venta: &NuevaVenta) -> Resultado<VentaRegistrada> {
    exigir_permiso_caja(conn, usuario)?;
    let turno = exigir_turno_abierto(conn)?;
    if venta.items.is_empty() {
        return Err(error("VENTA_VACIA", "Agrega al menos un producto o pase."));
    }
    if venta.items.len() > MAX_ITEMS {
        return Err(error("VENTA_MUY_GRANDE", "Una venta no puede tener más de 50 líneas."));
    }
    let g = gimnasio(conn)?;
    let puede_descontar = tiene_permiso(conn, usuario, "editar")?;

    // Cliente
    let cliente: Option<(String, String)> = match venta.deportista_id.as_deref().filter(|d| !d.is_empty()) {
        None => None,
        Some(id) => Some(
            conn.query_row("SELECT id, nombre FROM deportistas WHERE id = ?1 AND eliminado = 0", [id], |f| Ok((f.get(0)?, f.get(1)?)))
                .optional()?
                .ok_or_else(|| error("CLIENTE_NO_ENCONTRADO", "Ese cliente no está en esta estación."))?,
        ),
    };

    let mut items: Vec<ItemVendido> = Vec::new();
    let mut pedidos: BTreeMap<String, (i64, i64, String)> = BTreeMap::new(); // producto → (cantidad, disponible, nombre)
    for it in &venta.items {
        if !(1..=1000).contains(&it.cantidad) {
            return Err(error("CANTIDAD_INVALIDA", "La cantidad de cada línea debe estar entre 1 y 1.000."));
        }
        let (producto_id, descripcion, precio_lista) = match it.tipo.as_str() {
            "producto" => {
                let id = it.producto_id.as_deref().filter(|p| !p.is_empty()).ok_or_else(|| {
                    error("PRODUCTO_ID_REQUERIDO", "Elige el producto del inventario.")
                })?;
                let (nombre, precio, activo, disponible): (String, i64, bool, i64) = conn
                    .query_row(&format!("SELECT p.nombre, p.precio, p.activo, {} FROM productos p WHERE p.id = ?1", sql_disponible("p")), [id], |f| {
                        Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?))
                    })
                    .optional()?
                    .ok_or_else(|| error("PRODUCTO_NO_ENCONTRADO", "Ese producto no está en el inventario de esta estación."))?;
                if !activo {
                    return Err(error("PRODUCTO_INACTIVO", &format!("El producto '{nombre}' está desactivado.")));
                }
                let e = pedidos.entry(id.to_string()).or_insert((0, disponible, nombre.clone()));
                e.0 += it.cantidad;
                (Some(id.to_string()), nombre, precio)
            }
            "pase_dia" | "pase_clase" => {
                let configurado = if it.tipo == "pase_dia" { g.precio_pase_dia } else { g.precio_pase_clase };
                let precio = match configurado {
                    Some(p) => p,
                    None => it.precio.ok_or_else(|| error("PRECIO_REQUERIDO", "Escribe el precio del pase."))?,
                };
                monto_valido(precio, "el precio del pase")?;
                let nombre = if it.tipo == "pase_dia" { "Pase de día" } else { "Pase de clase" };
                (None, nombre.to_string(), precio)
            }
            _ => return Err(error("DATOS_INVALIDOS", "Tipo de línea desconocido.")),
        };
        let cobrado = it.precio_cobrado.unwrap_or(precio_lista);
        monto_valido(cobrado, "el precio cobrado")?;
        let motivo = validar_descuento(&g, puede_descontar, precio_lista, cobrado, it.motivo_descuento.as_deref())?;
        items.push(ItemVendido {
            tipo: it.tipo.clone(),
            producto_id,
            descripcion,
            cantidad: it.cantidad,
            precio_lista,
            precio_cobrado: cobrado,
            subtotal: cobrado * it.cantidad,
            motivo_descuento: motivo,
        });
    }
    for (cantidad, disponible, nombre) in pedidos.values() {
        if cantidad > disponible {
            return Err(error("STOCK_INSUFICIENTE", &format!("No hay suficiente '{nombre}': quedan {disponible} y pides {cantidad}.")));
        }
    }
    if items.iter().any(|i| i.tipo == "pase_dia") && cliente.is_none() {
        return Err(error("PASE_DIA_REQUIERE_CLIENTE", "El pase de día necesita un cliente registrado. Búscalo por nombre o documento."));
    }
    let total: i64 = items.iter().map(|i| i.subtotal).sum();
    if total > MAX_MONTO {
        return Err(error("MONTO_INVALIDO", "El total de la venta supera 100.000.000."));
    }

    let Cobro { tipo_medio, metodo, pagos, valor_recibido, cambio } =
        resolver_cobro(venta.metodo.as_deref(), venta.pagos.as_deref(), total, venta.valor_recibido)?;
    let nota = validar_nota(venta.nota.as_deref())?;

    let ts = a_texto(ahora);
    let tx = conn.unchecked_transaction()?;
    let payload = json!({
        "turno_id": turno.id,
        "deportista_id": cliente.as_ref().map(|c| c.0.clone()),
        "items": items.iter().map(|i| json!({
            "tipo": i.tipo, "producto_id": i.producto_id, "descripcion": i.descripcion, "cantidad": i.cantidad,
            "precio_lista": i.precio_lista, "precio_cobrado": i.precio_cobrado, "motivo_descuento": i.motivo_descuento,
        })).collect::<Vec<_>>(),
        "total": total,
        "tipo_medio": tipo_medio,
        "metodo": metodo,
        "pagos": pagos.iter().map(|p| json!({ "metodo": p.metodo, "tipo_medio": p.tipo_medio, "monto": p.monto })).collect::<Vec<_>>(),
        "valor_recibido": valor_recibido,
        "nota": nota,
    });
    let id = outbox::encolar(&tx, ahora, "venta", Some(&usuario.id), std::slice::from_ref(&turno.id), &payload)?;
    tx.execute(
        "INSERT INTO caja_ventas (id, turno_id, deportista_id, deportista_nombre, total, tipo_medio, metodo, valor_recibido, cambio,
                                  staff_id, ocurrida_en, fecha_negocio, nota)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            id, turno.id, cliente.as_ref().map(|c| &c.0), cliente.as_ref().map(|c| &c.1), total, tipo_medio, metodo, valor_recibido,
            cambio, usuario.id, ts, fecha_negocio(ahora).to_string(), nota,
        ],
    )?;
    for i in &items {
        tx.execute(
            "INSERT INTO caja_venta_items (venta_id, tipo, producto_id, descripcion, cantidad, precio_lista, precio_cobrado, subtotal, motivo_descuento)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![id, i.tipo, i.producto_id, i.descripcion, i.cantidad, i.precio_lista, i.precio_cobrado, i.subtotal, i.motivo_descuento],
        )?;
    }
    for p in &pagos {
        tx.execute(
            "INSERT INTO caja_venta_medios (venta_id, metodo, tipo_medio, monto) VALUES (?1, ?2, ?3, ?4)",
            params![id, p.metodo, p.tipo_medio, p.monto],
        )?;
    }
    // E-32: el pase de día vendido aquí deja entrar desde ya, con o sin red.
    if let (Some((dep, _)), true) = (&cliente, items.iter().any(|i| i.tipo == "pase_dia")) {
        tx.execute(
            "INSERT OR REPLACE INTO pases_dia (id, deportista_id, created_at, anulada) VALUES (?1, ?2, ?3, 0)",
            params![id, dep, ts],
        )?;
    }
    auditoria::registrar(
        &tx,
        ahora,
        Actor::persona(&usuario.id, &usuario.nombre),
        "REGISTRAR_VENTA",
        "caja_ventas",
        Some(&id),
        &json!({ "turno_id": turno.id, "total": total, "tipo_medio": tipo_medio, "lineas": items.len() }),
    )?;
    tx.commit()?;
    Ok(VentaRegistrada {
        id,
        turno_id: turno.id,
        deportista_nombre: cliente.map(|c| c.1),
        items,
        total,
        tipo_medio,
        metodo,
        pagos,
        valor_recibido,
        cambio,
        ocurrida_en: ts,
    })
}

/// La venta llegó al servidor (aplicada o por revisar): su stock ya está en el del servidor.
/// Se descuenta aquí también, para que el disponible no suba mientras llega la siguiente descarga.
pub fn stock_confirmado(conn: &Connection, venta_id: &str) -> Resultado<()> {
    conn.execute(
        "UPDATE productos SET stock = stock - (SELECT sum(i.cantidad) FROM caja_venta_items i WHERE i.venta_id = ?1 AND i.producto_id = productos.id)
         WHERE id IN (SELECT producto_id FROM caja_venta_items WHERE venta_id = ?1 AND producto_id IS NOT NULL)",
        [venta_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Egresos
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EgresoRegistrado {
    pub id: String,
    pub turno_id: String,
    pub monto: i64,
    pub motivo: String,
    pub ocurrido_en: String,
}

pub fn registrar_egreso(conn: &Connection, ahora: DateTime<Utc>, usuario: &UsuarioSesion, monto: i64, motivo: &str) -> Resultado<EgresoRegistrado> {
    exigir_permiso_caja(conn, usuario)?;
    let turno = exigir_turno_abierto(conn)?;
    if monto <= 0 || monto > MAX_MONTO {
        return Err(error("MONTO_INVALIDO", "Escribe el monto del egreso."));
    }
    let motivo = motivo.trim();
    if motivo.chars().count() < MOTIVO_MINIMO {
        return Err(error("MOTIVO_REQUERIDO", "Escribe el motivo del egreso (mínimo 4 letras)."));
    }
    if motivo.chars().count() > 255 {
        return Err(error("MOTIVO_MUY_LARGO", "El motivo no puede pasar de 255 letras."));
    }
    let ts = a_texto(ahora);
    let tx = conn.unchecked_transaction()?;
    let id = outbox::encolar(
        &tx,
        ahora,
        "egreso",
        Some(&usuario.id),
        std::slice::from_ref(&turno.id),
        &json!({ "turno_id": turno.id, "monto": monto, "motivo": motivo }),
    )?;
    tx.execute(
        "INSERT INTO caja_egresos (id, turno_id, monto, motivo, staff_id, ocurrido_en, fecha_negocio) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, turno.id, monto, motivo, usuario.id, ts, fecha_negocio(ahora).to_string()],
    )?;
    auditoria::registrar(
        &tx,
        ahora,
        Actor::persona(&usuario.id, &usuario.nombre),
        "REGISTRAR_EGRESO_CAJA",
        "caja_egresos",
        Some(&id),
        &json!({ "turno_id": turno.id, "monto": monto, "motivo": motivo }),
    )?;
    tx.commit()?;
    Ok(EgresoRegistrado { id, turno_id: turno.id, monto, motivo: motivo.into(), ocurrido_en: ts })
}

// ---------------------------------------------------------------------------
// Movimientos y cierre diario
// ---------------------------------------------------------------------------
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Movimiento {
    pub id: String,
    /// venta | egreso
    pub tipo: String,
    pub ocurrido_en: String,
    pub concepto: String,
    pub metodo: String,
    /// Positivo lo que entra, negativo lo que sale.
    pub monto: i64,
    pub registrado_por: Option<String>,
    /// Estado de su operación en la cola: pendiente, aplicada, pendiente_revision, error…
    pub envio: String,
}

pub fn movimientos(conn: &Connection, turno_id: &str) -> Resultado<Vec<Movimiento>> {
    let mut stmt = conn.prepare(
        "SELECT v.id, 'venta', v.ocurrida_en,
                (SELECT group_concat(CASE WHEN i.cantidad > 1 THEN i.cantidad || ' × ' ELSE '' END || i.descripcion, ', ')
                   FROM caja_venta_items i WHERE i.venta_id = v.id)
                  || CASE WHEN v.deportista_nombre IS NOT NULL THEN ' · ' || v.deportista_nombre ELSE '' END,
                CASE WHEN v.tipo_medio = 'mixto'
                     THEN (SELECT group_concat(m.metodo, ' + ') FROM caja_venta_medios m WHERE m.venta_id = v.id) ELSE v.metodo END,
                v.total, s.nombre, o.estado
         FROM caja_ventas v JOIN sync_outbox o ON o.id = v.id LEFT JOIN staff_local s ON s.id = v.staff_id
         WHERE v.turno_id = ?1
         UNION ALL
         SELECT p.id, 'membresia', p.ocurrida_en,
                CASE p.tipo WHEN 'venta' THEN 'Venta de plan ' ELSE 'Renovación ' END || p.plan_nombre || ' · ' || p.deportista_nombre,
                CASE WHEN p.tipo_medio = 'mixto'
                     THEN (SELECT group_concat(m.metodo, ' + ') FROM caja_pago_membresia_medios m WHERE m.pago_id = p.id) ELSE p.metodo END,
                p.precio_cobrado, s.nombre, o.estado
         FROM caja_pagos_membresia p JOIN sync_outbox o ON o.id = p.id LEFT JOIN staff_local s ON s.id = p.staff_id
         WHERE p.turno_id = ?1
         UNION ALL
         SELECT e.id, 'egreso', e.ocurrido_en, e.motivo, 'Efectivo', -e.monto, s.nombre, o.estado
         FROM caja_egresos e JOIN sync_outbox o ON o.id = e.id LEFT JOIN staff_local s ON s.id = e.staff_id
         WHERE e.turno_id = ?1
         ORDER BY 3 DESC",
    )?;
    let filas = stmt.query_map([turno_id], |f| {
        Ok(Movimiento {
            id: f.get(0)?,
            tipo: f.get(1)?,
            ocurrido_en: f.get(2)?,
            concepto: f.get(3)?,
            metodo: f.get(4)?,
            monto: f.get(5)?,
            registrado_por: f.get(6)?,
            envio: f.get(7)?,
        })
    })?;
    Ok(filas.collect::<Result<_, _>>()?)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CierreDiario {
    pub fecha: String,
    pub turnos: Vec<ResumenTurno>,
    /// Suma de los turnos del día.
    pub totales: Totales,
    /// Del efectivo de los turnos ya cerrados: lo contado y la diferencia.
    pub efectivo_contado: i64,
    pub diferencia: i64,
    pub turnos_abiertos: i64,
    /// Ventas y egresos del día que aún no han subido al servidor.
    pub sin_subir: i64,
}

/// Cierre diario (A3): el resumen de los turnos que se abrieron ese día en esta estación. Funciona sin red.
pub fn cierre_diario(conn: &Connection, fecha: NaiveDate) -> Resultado<CierreDiario> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare("SELECT id FROM caja_turnos WHERE fecha_negocio = ?1 ORDER BY abierto_en")?;
        let filas = stmt.query_map([fecha.to_string()], |f| f.get(0))?;
        filas.collect::<Result<_, _>>()?
    };
    let mut turnos = Vec::new();
    let mut t = Totales::default();
    let mut por_metodo: BTreeMap<(String, String), i64> = BTreeMap::new();
    let (mut contado, mut diferencia, mut abiertos) = (0, 0, 0);
    for id in ids {
        let r = resumen(conn, &id)?;
        t.base_inicial += r.totales.base_inicial;
        t.ventas_efectivo += r.totales.ventas_efectivo;
        t.ventas_otro += r.totales.ventas_otro;
        t.membresias_efectivo += r.totales.membresias_efectivo;
        t.membresias_otro += r.totales.membresias_otro;
        t.egresos_efectivo += r.totales.egresos_efectivo;
        t.total_esperado_efectivo += r.totales.total_esperado_efectivo;
        t.num_ventas += r.totales.num_ventas;
        t.num_membresias += r.totales.num_membresias;
        t.num_egresos += r.totales.num_egresos;
        for p in &r.totales.por_metodo {
            *por_metodo.entry((p.metodo.clone(), p.tipo_medio.clone())).or_default() += p.monto;
        }
        if r.turno.estado == "cerrado" {
            contado += r.turno.efectivo_contado.unwrap_or(0);
            diferencia += r.turno.diferencia.unwrap_or(0);
        } else {
            abiertos += 1;
        }
        turnos.push(r);
    }
    t.por_metodo = por_metodo.into_iter().map(|((metodo, tipo_medio), monto)| PorMetodo { metodo, tipo_medio, monto }).collect();
    t.por_metodo.sort_by(|a, b| b.monto.cmp(&a.monto).then(a.metodo.cmp(&b.metodo)));
    let sin_subir: i64 = conn.query_row(
        &format!(
            "SELECT count(*) FROM sync_outbox o
             WHERE o.estado IN {SIN_SUBIR} AND o.id IN (
               SELECT v.id FROM caja_ventas v JOIN caja_turnos t ON t.id = v.turno_id WHERE t.fecha_negocio = ?1
               UNION ALL SELECT p.id FROM caja_pagos_membresia p JOIN caja_turnos t ON t.id = p.turno_id WHERE t.fecha_negocio = ?1
               UNION ALL SELECT e.id FROM caja_egresos e JOIN caja_turnos t ON t.id = e.turno_id WHERE t.fecha_negocio = ?1)"
        ),
        [fecha.to_string()],
        |f| f.get(0),
    )?;
    Ok(CierreDiario { fecha: fecha.to_string(), turnos, totales: t, efectivo_contado: contado, diferencia, turnos_abiertos: abiertos, sin_subir })
}

// ---------------------------------------------------------------------------
// Turno único con red (A1)
// ---------------------------------------------------------------------------
/// Antes de abrir: con red, se pregunta al servidor si hay otro turno abierto en el gimnasio y, si lo
/// hay, se rechaza. Sin red (o si el servidor no puede responder la consulta) no se puede confirmar:
/// se abre igual y queda marcado.
pub fn confirmar_turno_unico(
    transporte: &dyn crate::sync::transporte::Transporte,
    credenciales: Option<&crate::sync::descarga::Credenciales>,
) -> Resultado<Confirmacion> {
    use crate::sync::transporte::{ErrorTransporte, Metodo, Peticion};
    let Some(c) = credenciales else { return Ok(Confirmacion::SinRed) };
    let consulta = transporte.enviar(
        &c.api_base,
        Peticion { metodo: Metodo::Get, ruta: "/sync/caja/turno-abierto", token: Some(&c.token), consulta: vec![], cuerpo: None },
    );
    match consulta {
        Ok(r) if r["abierto"].as_bool() == Some(true) => {
            let donde = r["donde"].as_str().unwrap_or("otro lugar").to_string();
            let quien = r["abierto_por_nombre"].as_str().unwrap_or("otra persona").to_string();
            Err(ErrorApp::con_detalles(
                "TURNO_AJENO_ABIERTO",
                &format!("Ya hay una caja abierta en {donde} ({quien}). Debe cerrarse antes de abrir aquí."),
                r,
            ))
        }
        Ok(_) => Ok(Confirmacion::Confirmada),
        Err(ErrorTransporte::Servidor { codigo, mensaje, detalles, .. }) if codigo == "ESTACION_REVOCADA" || codigo == "GIMNASIO_SUSPENDIDO" => {
            Err(ErrorApp { codigo, mensaje, detalles })
        }
        Err(_) => Ok(Confirmacion::SinRed),
    }
}
