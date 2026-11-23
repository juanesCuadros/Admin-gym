//! Vender y renovar membresías en la estación (fase 3B, parte 1, E-36). Con red y sin ella.
//!
//! - **Renovar:** la membresía más reciente sin cancelar del cliente, con su mismo plan. La fecha nueva sale
//!   de la regla C2, copiada del servidor (`caja/reglas.py`).
//! - **Vender:** solo a un cliente sin membresía vigente ni cancelada pendiente, y solo planes individuales.
//!   Cliente nuevo, paquetes (pareja o familiar), cambio de plan y congelar quedan para la web.
//! - El pago va al turno abierto de la estación y cuenta en su arqueo. La membresía local cambia de
//!   inmediato, para que el cliente pueda entrar de una vez; al subir, el servidor recalcula la fecha y,
//!   si no coincide, manda la suya y queda por revisar.

use chrono::{DateTime, Duration, NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;

use super::{
    error, exigir_permiso_caja, exigir_turno_abierto, gimnasio, monto_valido, resolver_cobro, tiene_permiso, validar_descuento,
    Cobro, NuevoMedio, PorMetodo, SIN_SUBIR,
};
use crate::acceso::registro::{evaluar_cliente, ClienteEvaluado};
use crate::auditoria::{self, Actor};
use crate::error::{ErrorApp, Resultado};
use crate::reloj::{a_texto, fecha_negocio};
use crate::sesion::UsuarioSesion;
use crate::sync::outbox;

/// Regla C2 de renovación (GW-RF-25 CA1 y CA2), igual que `calcular_vencimiento_renovacion_c2` del servidor.
/// - Vigente: suma los días desde el vencimiento actual, sin perder días.
/// - En gracia o vencida: si entró en algún día de gracia, cuenta desde el vencimiento; si no, desde hoy.
pub fn regla_c2(vencimiento: NaiveDate, hoy: NaiveDate, dias: i64, entro_en_gracia: bool) -> NaiveDate {
    let inicio = if vencimiento >= hoy || entro_en_gracia { vencimiento } else { hoy };
    inicio + Duration::days(dias)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MembresiaActual {
    pub id: String,
    pub plan_id: String,
    pub plan_nombre: String,
    pub fecha_vencimiento: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Renovacion {
    pub precio_lista: i64,
    pub dias: i64,
    /// Fecha en que quedaría vencida si se renueva hoy.
    pub fecha_vencimiento_nueva: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlanVenta {
    pub id: String,
    pub nombre: String,
    pub precio: i64,
    pub duracion_dias: i64,
    /// Fecha en que vencería si se vende hoy.
    pub fecha_vencimiento: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpcionesMembresia {
    pub cliente: ClienteEvaluado,
    pub membresia: Option<MembresiaActual>,
    /// Con membresía: renovar. Sin membresía: vender uno de `planes`.
    pub renovacion: Option<Renovacion>,
    pub planes: Vec<PlanVenta>,
    /// Por qué no se puede cobrar aquí (p. ej. el plan ya no está en la estación). Se hace en la web.
    pub aviso: Option<String>,
}

struct Actual {
    id: String,
    plan_id: String,
    plan_nombre: Option<String>,
    vencimiento: NaiveDate,
    precio_vendido: Option<i64>,
    plan_precio: Option<i64>,
    plan_dias: Option<i64>,
}

/// La más reciente sin cancelar: mismo orden que el servidor y que la regla de ingreso.
fn membresia_actual(conn: &Connection, deportista_id: &str) -> Resultado<Option<Actual>> {
    let fila: Option<(String, String, Option<String>, String, Option<i64>, Option<i64>, Option<i64>)> = conn
        .query_row(
            "SELECT m.id, m.plan_id, p.nombre, m.fecha_vencimiento, m.plan_precio_vendido, p.precio, p.duracion_dias
             FROM membresias m LEFT JOIN planes p ON p.id = m.plan_id
             WHERE m.deportista_id = ?1 AND m.cancelada = 0
             ORDER BY m.fecha_vencimiento DESC, m.created_at DESC LIMIT 1",
            [deportista_id],
            |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?, f.get(4)?, f.get(5)?, f.get(6)?)),
        )
        .optional()?;
    let Some((id, plan_id, plan_nombre, venc, precio_vendido, plan_precio, plan_dias)) = fila else { return Ok(None) };
    let vencimiento = venc
        .parse()
        .map_err(|_| ErrorApp::nuevo("DATOS_LOCALES_INVALIDOS", "Hay una membresía con una fecha que GymDesk no entiende. Sincroniza de nuevo."))?;
    Ok(Some(Actual { id, plan_id, plan_nombre, vencimiento, precio_vendido, plan_precio, plan_dias }))
}

/// ¿Entró en algún día de gracia (vencimiento+1 … vencimiento+gracia)? Con los ingresos de esta estación;
/// los de la web solo los conoce el servidor, que corrige la fecha si hace falta.
fn entro_en_gracia(conn: &Connection, deportista_id: &str, vencimiento: NaiveDate, gracia: i64) -> Resultado<bool> {
    if gracia <= 0 {
        return Ok(false);
    }
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM ingresos WHERE deportista_id = ?1 AND tipo = 'ingreso' AND resultado IN ('abrio','alerta_mora')
                         AND fecha_negocio BETWEEN ?2 AND ?3)",
        params![
            deportista_id,
            (vencimiento + Duration::days(1)).to_string(),
            (vencimiento + Duration::days(gracia)).to_string()
        ],
        |f| f.get(0),
    )?)
}

fn dias_gracia(conn: &Connection) -> Resultado<i64> {
    conn.query_row("SELECT dias_gracia_mora FROM gimnasio LIMIT 1", [], |f| f.get(0))
        .optional()?
        .ok_or_else(|| error("DATOS_SIN_DESCARGAR", "Esta estación aún no ha descargado los datos del gimnasio. Conéctala a internet."))
}

fn calcular_renovacion(conn: &Connection, deportista_id: &str, a: &Actual, hoy: NaiveDate) -> Resultado<Result<Renovacion, String>> {
    let (Some(dias), Some(plan_precio)) = (a.plan_dias, a.plan_precio) else {
        return Ok(Err("El plan de esta membresía ya no está en la estación. Renuévala desde la web.".into()));
    };
    let precio_lista = a.precio_vendido.unwrap_or(plan_precio);
    if precio_lista <= 0 {
        return Ok(Err("El plan de esta membresía no tiene precio. Renuévala desde la web.".into()));
    }
    let dias = if dias > 0 { dias } else { 30 };
    let gracia = dias_gracia(conn)?;
    let en_gracia = a.vencimiento < hoy && entro_en_gracia(conn, deportista_id, a.vencimiento, gracia)?;
    Ok(Ok(Renovacion { precio_lista, dias, fecha_vencimiento_nueva: regla_c2(a.vencimiento, hoy, dias, en_gracia).to_string() }))
}

fn planes_para_venta(conn: &Connection, hoy: NaiveDate) -> Resultado<Vec<PlanVenta>> {
    let mut stmt = conn.prepare(
        "SELECT id, nombre, precio, duracion_dias FROM planes
         WHERE activo = 1 AND tipo = 'individual' AND precio > 0 AND duracion_dias > 0 ORDER BY precio, nombre",
    )?;
    let filas = stmt.query_map([], |f| Ok((f.get::<_, String>(0)?, f.get::<_, String>(1)?, f.get::<_, i64>(2)?, f.get::<_, i64>(3)?)))?;
    let mut lista = Vec::new();
    for fila in filas {
        let (id, nombre, precio, duracion_dias) = fila?;
        lista.push(PlanVenta { id, nombre, precio, duracion_dias, fecha_vencimiento: (hoy + Duration::days(duracion_dias)).to_string() });
    }
    Ok(lista)
}

/// Qué se le puede cobrar a un cliente: renovar su membresía o venderle un plan.
pub fn opciones(conn: &Connection, deportista_id: &str, hoy: NaiveDate) -> Resultado<OpcionesMembresia> {
    let cliente = evaluar_cliente(conn, deportista_id, hoy)?
        .ok_or_else(|| error("CLIENTE_NO_ENCONTRADO", "Ese cliente no está en esta estación."))?;
    let actual = membresia_actual(conn, deportista_id)?;
    let (mut renovacion, mut planes, mut aviso) = (None, vec![], None);
    let membresia = match &actual {
        Some(a) => {
            match calcular_renovacion(conn, deportista_id, a, hoy)? {
                Ok(r) => renovacion = Some(r),
                Err(m) => aviso = Some(m),
            }
            Some(MembresiaActual {
                id: a.id.clone(),
                plan_id: a.plan_id.clone(),
                plan_nombre: a.plan_nombre.clone().unwrap_or_else(|| "Plan".into()),
                fecha_vencimiento: a.vencimiento.to_string(),
            })
        }
        None => {
            planes = planes_para_venta(conn, hoy)?;
            if planes.is_empty() {
                aviso = Some("No hay planes individuales activos en la estación. Créalos en la web y sincroniza.".into());
            }
            None
        }
    };
    if cliente.estado == "desactivado" {
        aviso = Some("Este cliente está desactivado. Actívalo desde la web antes de cobrarle.".into());
        renovacion = None;
        planes.clear();
    }
    Ok(OpcionesMembresia { cliente, membresia, renovacion, planes, aviso })
}

#[derive(Debug, Clone, Deserialize)]
pub struct NuevoCobroMembresia {
    pub deportista_id: String,
    /// renovar | vender
    pub accion: String,
    /// Solo al vender.
    pub plan_id: Option<String>,
    /// Si es menor que el de lista, es un descuento: exige permiso, motivo y respetar el tope.
    pub precio_cobrado: Option<i64>,
    pub motivo_descuento: Option<String>,
    pub metodo: Option<String>,
    pub pagos: Option<Vec<NuevoMedio>>,
    pub valor_recibido: Option<i64>,
    #[serde(default)]
    pub nota: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CobroMembresiaRegistrado {
    pub id: String,
    pub tipo: String,
    pub turno_id: String,
    pub membresia_id: String,
    pub deportista_nombre: String,
    pub plan_nombre: String,
    pub fecha_vencimiento_anterior: Option<String>,
    pub fecha_vencimiento_nueva: String,
    pub precio_lista: i64,
    pub precio_cobrado: i64,
    pub tipo_medio: String,
    pub metodo: String,
    pub pagos: Vec<PorMetodo>,
    pub valor_recibido: Option<i64>,
    pub cambio: Option<i64>,
    pub ocurrida_en: String,
}

pub fn cobrar(conn: &Connection, ahora: DateTime<Utc>, usuario: &UsuarioSesion, c: &NuevoCobroMembresia) -> Resultado<CobroMembresiaRegistrado> {
    exigir_permiso_caja(conn, usuario)?;
    let turno = exigir_turno_abierto(conn)?;
    let hoy = fecha_negocio(ahora);
    let op = opciones(conn, &c.deportista_id, hoy)?;
    if let Some(aviso) = &op.aviso {
        return Err(error("NO_SE_PUEDE_COBRAR_AQUI", aviso));
    }
    let membresia_nueva = uuid::Uuid::new_v4().to_string();
    // (tipo, membresía, plan, nombre del plan, días, inicio, vencimiento anterior, vencimiento nuevo, precio de lista)
    let (tipo, membresia_id, plan_id, plan_nombre, dias, inicio, anterior, nueva, lista) = match c.accion.as_str() {
        "renovar" => {
            let (Some(m), Some(r)) = (&op.membresia, &op.renovacion) else {
                return Err(error("SIN_MEMBRESIA", "Este cliente no tiene membresía para renovar. Véndele un plan."));
            };
            ("renovacion", m.id.clone(), m.plan_id.clone(), m.plan_nombre.clone(), r.dias, None,
             Some(m.fecha_vencimiento.clone()), r.fecha_vencimiento_nueva.clone(), r.precio_lista)
        }
        "vender" => {
            if op.membresia.is_some() {
                return Err(error(
                    "MEMBRESIA_EXISTENTE",
                    "Este cliente ya tiene una membresía. Renuévala; para cambiarle el plan usa la web.",
                ));
            }
            let plan_id = c.plan_id.as_deref().filter(|p| !p.is_empty()).ok_or_else(|| error("PLAN_REQUERIDO", "Elige el plan."))?;
            let p = op.planes.iter().find(|p| p.id == plan_id).ok_or_else(|| {
                error("PLAN_NO_DISPONIBLE", "Ese plan no se puede vender aquí. Solo planes individuales activos.")
            })?;
            ("venta", membresia_nueva, p.id.clone(), p.nombre.clone(), p.duracion_dias, Some(hoy.to_string()), None,
             p.fecha_vencimiento.clone(), p.precio)
        }
        _ => return Err(error("DATOS_INVALIDOS", "Acción desconocida.")),
    };

    let g = gimnasio(conn)?;
    let cobrado = c.precio_cobrado.unwrap_or(lista);
    monto_valido(cobrado, "el valor cobrado")?;
    if cobrado <= 0 {
        return Err(error("MONTO_INVALIDO", "El valor cobrado debe ser mayor que cero."));
    }
    let motivo = validar_descuento(&g, tiene_permiso(conn, usuario, "editar")?, lista, cobrado, c.motivo_descuento.as_deref())?;
    let Cobro { tipo_medio, metodo, pagos, valor_recibido, cambio } =
        resolver_cobro(c.metodo.as_deref(), c.pagos.as_deref(), cobrado, c.valor_recibido)?;
    let nota = super::validar_nota(c.nota.as_deref())?;

    let ts = a_texto(ahora);
    let medios_json: Vec<_> = pagos.iter().map(|p| json!({ "metodo": p.metodo, "tipo_medio": p.tipo_medio, "monto": p.monto })).collect();
    let mut payload = json!({
        "turno_id": turno.id, "membresia_id": membresia_id, "deportista_id": c.deportista_id, "dias": dias,
        "precio_lista": lista, "precio_cobrado": cobrado, "motivo_descuento": motivo,
        "tipo_medio": tipo_medio, "metodo": metodo, "pagos": medios_json, "valor_recibido": valor_recibido, "nota": nota,
    });
    let tipo_op = if tipo == "venta" {
        payload["plan_id"] = json!(plan_id);
        payload["fecha_inicio"] = json!(inicio);
        payload["fecha_vencimiento"] = json!(nueva);
        "membresia_vender"
    } else {
        payload["fecha_vencimiento_anterior"] = json!(anterior);
        payload["fecha_vencimiento_nueva"] = json!(nueva);
        "membresia_renovar"
    };

    let tx = conn.unchecked_transaction()?;
    let id = outbox::encolar(&tx, ahora, tipo_op, Some(&usuario.id), std::slice::from_ref(&turno.id), &payload)?;
    tx.execute(
        "INSERT INTO caja_pagos_membresia (id, tipo, turno_id, membresia_id, deportista_id, deportista_nombre, plan_id, plan_nombre, dias,
           fecha_inicio, fecha_vencimiento_anterior, fecha_vencimiento_nueva, precio_lista, precio_cobrado, motivo_descuento,
           tipo_medio, metodo, valor_recibido, cambio, staff_id, ocurrida_en, fecha_negocio, nota)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
        params![
            id, tipo, turno.id, membresia_id, c.deportista_id, op.cliente.nombre, plan_id, plan_nombre, dias, inicio, anterior, nueva,
            lista, cobrado, motivo, tipo_medio, metodo, valor_recibido, cambio, usuario.id, ts, hoy.to_string(), nota,
        ],
    )?;
    for p in &pagos {
        tx.execute(
            "INSERT INTO caja_pago_membresia_medios (pago_id, metodo, tipo_medio, monto) VALUES (?1, ?2, ?3, ?4)",
            params![id, p.metodo, p.tipo_medio, p.monto],
        )?;
    }
    aplicar_a_membresia(&tx, &id)?;
    auditoria::registrar(
        &tx,
        ahora,
        Actor::persona(&usuario.id, &usuario.nombre),
        if tipo == "venta" { "ASIGNAR_MEMBRESIA" } else { "RENOVAR_MEMBRESIA" },
        "caja_pagos_membresia",
        Some(&id),
        &json!({ "turno_id": turno.id, "membresia_id": membresia_id, "monto": cobrado, "tipo_medio": tipo_medio,
                 "vencimiento_anterior": anterior, "vencimiento_nuevo": nueva }),
    )?;
    tx.commit()?;
    Ok(CobroMembresiaRegistrado {
        id,
        tipo: tipo.into(),
        turno_id: turno.id,
        membresia_id,
        deportista_nombre: op.cliente.nombre,
        plan_nombre,
        fecha_vencimiento_anterior: anterior,
        fecha_vencimiento_nueva: nueva,
        precio_lista: lista,
        precio_cobrado: cobrado,
        tipo_medio,
        metodo,
        pagos,
        valor_recibido,
        cambio,
        ocurrida_en: ts,
    })
}

/// Lleva un cobro a la membresía local: la crea (venta) o le pone la fecha nueva (renovación).
fn aplicar_a_membresia(conn: &Connection, pago_id: &str) -> Resultado<()> {
    conn.execute(
        "INSERT OR REPLACE INTO membresias (id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada, created_at, plan_precio_vendido)
         SELECT membresia_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento_nueva, 0, ocurrida_en, precio_lista
         FROM caja_pagos_membresia WHERE id = ?1 AND tipo = 'venta'",
        [pago_id],
    )?;
    conn.execute(
        "UPDATE membresias SET fecha_vencimiento = (SELECT fecha_vencimiento_nueva FROM caja_pagos_membresia WHERE id = ?1)
         WHERE id = (SELECT membresia_id FROM caja_pagos_membresia WHERE id = ?1 AND tipo = 'renovacion')",
        [pago_id],
    )?;
    Ok(())
}

/// Tras cada página de la descarga: lo cobrado aquí que aún no llegó al servidor se vuelve a aplicar,
/// en el orden en que ocurrió, para que la descarga no lo deshaga. Lo que ya llegó lo trae el servidor
/// con su propia fecha.
pub fn reaplicar_sin_subir(conn: &Connection) -> Resultado<()> {
    let ids: Vec<String> = {
        let mut stmt = conn.prepare(&format!(
            "SELECT p.id FROM caja_pagos_membresia p JOIN sync_outbox o ON o.id = p.id
             WHERE o.estado IN {SIN_SUBIR} ORDER BY p.ocurrida_en, o.secuencia"
        ))?;
        let filas = stmt.query_map([], |f| f.get(0))?;
        filas.collect::<Result<_, _>>()?
    };
    for id in ids {
        aplicar_a_membresia(conn, &id)?;
    }
    Ok(())
}

#[cfg(test)]
mod pruebas_regla {
    use super::regla_c2;
    use chrono::NaiveDate;

    fn f(t: &str) -> NaiveDate {
        t.parse().unwrap()
    }

    #[test]
    fn vigente_suma_desde_el_vencimiento() {
        assert_eq!(regla_c2(f("2026-12-10"), f("2026-11-22"), 30, false), f("2027-01-09"));
        // Vence hoy: sigue vigente.
        assert_eq!(regla_c2(f("2026-11-22"), f("2026-11-22"), 30, false), f("2026-12-22"));
    }

    #[test]
    fn vencida_sin_entrar_en_gracia_cuenta_desde_hoy() {
        assert_eq!(regla_c2(f("2026-11-20"), f("2026-11-22"), 30, false), f("2026-12-22"));
    }

    #[test]
    fn vencida_que_entro_en_gracia_cuenta_desde_el_vencimiento() {
        assert_eq!(regla_c2(f("2026-11-20"), f("2026-11-22"), 30, true), f("2026-12-20"));
    }
}
