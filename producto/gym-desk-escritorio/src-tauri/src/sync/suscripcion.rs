//! Estado de la suscripción del gimnasio, calculado en la estación.
//!
//! Misma regla que `platform.estado_suscripcion()` del servidor (P-01): aviso desde 5 días antes
//! del corte, días 1–3 funciona con aviso, desde el día 4 bloqueado; prueba vencida bloquea de
//! inmediato. Se calcula con la fecha de corte descargada, así que quitar la red no lo evita.

use chrono::NaiveDate;
use rusqlite::Connection;
use serde::Serialize;

use crate::error::Resultado;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EstadoSuscripcion {
    /// `al_dia` | `por_vencer` | `en_gracia` | `bloqueado`
    pub estado: &'static str,
    /// Días que faltan para el corte (negativo: días después del corte). `None` si no hay fecha.
    pub dias_restantes: Option<i64>,
    /// `falta_pago` | `prueba_vencida` | `suspendido` | `cancelado`
    pub motivo_bloqueo: Option<String>,
    pub fecha_corte: Option<NaiveDate>,
}

pub fn calcular(
    estado_guardado: Option<&str>,
    fecha_corte: Option<NaiveDate>,
    hoy: NaiveDate,
    bloqueado_por_servidor: bool,
    motivo_servidor: Option<&str>,
) -> EstadoSuscripcion {
    let d = fecha_corte.map(|corte| (hoy - corte).num_days());
    let dias_restantes = d.map(|d| -d);
    let bloqueado = |motivo: &str| EstadoSuscripcion {
        estado: "bloqueado",
        dias_restantes,
        motivo_bloqueo: Some(motivo.to_string()),
        fecha_corte,
    };

    match estado_guardado {
        Some("suspendido") => return bloqueado("suspendido"),
        Some("cancelado") => return bloqueado("cancelado"),
        _ => {}
    }
    if let Some(d) = d {
        if estado_guardado == Some("prueba") && d >= 1 {
            return bloqueado("prueba_vencida");
        }
        if d >= 4 {
            return bloqueado("falta_pago");
        }
    }
    // El servidor dijo "suspendido" y la regla local aún no lo ve (p. ej. lo suspendieron a mano
    // después de la última descarga): manda el servidor.
    if bloqueado_por_servidor {
        return bloqueado(motivo_servidor.unwrap_or("suspendido"));
    }
    let estado = match d {
        Some(d) if d >= 1 => "en_gracia",
        Some(d) if d >= -5 => "por_vencer",
        _ => "al_dia",
    };
    EstadoSuscripcion { estado, dias_restantes, motivo_bloqueo: None, fecha_corte }
}

/// Lee lo descargado y calcula el estado para la fecha de negocio de hoy.
pub fn estado_actual(conn: &Connection, hoy: NaiveDate) -> Resultado<EstadoSuscripcion> {
    let (guardado, corte, bloqueado, motivo): (Option<String>, Option<String>, bool, Option<String>) = conn.query_row(
        "SELECT estado_guardado, fecha_corte, bloqueado_por_servidor, motivo_servidor FROM suscripcion WHERE id = 1",
        [],
        |f| Ok((f.get(0)?, f.get(1)?, f.get(2)?, f.get(3)?)),
    )?;
    let corte = corte.and_then(|c| NaiveDate::parse_from_str(&c, "%Y-%m-%d").ok());
    Ok(calcular(guardado.as_deref(), corte, hoy, bloqueado, motivo.as_deref()))
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn dia(texto: &str) -> NaiveDate {
        NaiveDate::parse_from_str(texto, "%Y-%m-%d").unwrap()
    }

    fn con_corte(estado: &str, corte: &str, hoy: &str) -> EstadoSuscripcion {
        calcular(Some(estado), Some(dia(corte)), dia(hoy), false, None)
    }

    #[test]
    fn avisa_desde_cinco_dias_antes_del_corte() {
        assert_eq!(con_corte("activo", "2026-11-20", "2026-11-14").estado, "al_dia");
        let e = con_corte("activo", "2026-11-20", "2026-11-15");
        assert_eq!((e.estado, e.dias_restantes), ("por_vencer", Some(5)));
        assert_eq!(con_corte("activo", "2026-11-20", "2026-11-20").estado, "por_vencer");
    }

    #[test]
    fn los_dias_1_a_3_despues_del_corte_funciona_con_aviso_y_el_4_se_bloquea() {
        for (hoy, esperado) in [("2026-11-21", "en_gracia"), ("2026-11-23", "en_gracia"), ("2026-11-24", "bloqueado")] {
            assert_eq!(con_corte("activo", "2026-11-20", hoy).estado, esperado, "{hoy}");
        }
        let e = con_corte("activo", "2026-11-20", "2026-11-24");
        assert_eq!(e.motivo_bloqueo.as_deref(), Some("falta_pago"));
        assert_eq!(e.dias_restantes, Some(-4));
    }

    #[test]
    fn la_prueba_vencida_bloquea_de_inmediato() {
        assert_eq!(con_corte("prueba", "2026-11-20", "2026-11-20").estado, "por_vencer");
        let e = con_corte("prueba", "2026-11-20", "2026-11-21");
        assert_eq!((e.estado, e.motivo_bloqueo.as_deref()), ("bloqueado", Some("prueba_vencida")));
    }

    #[test]
    fn suspendido_o_cancelado_bloquean_aunque_la_fecha_este_al_dia() {
        for estado in ["suspendido", "cancelado"] {
            let e = con_corte(estado, "2027-01-01", "2026-11-12");
            assert_eq!((e.estado, e.motivo_bloqueo.as_deref()), ("bloqueado", Some(estado)));
        }
    }

    #[test]
    fn sin_fecha_de_corte_esta_al_dia() {
        let e = calcular(Some("activo"), None, dia("2026-11-12"), false, None);
        assert_eq!((e.estado, e.dias_restantes), ("al_dia", None));
    }

    #[test]
    fn si_el_servidor_dijo_suspendido_la_estacion_se_bloquea_aunque_su_fecha_diga_al_dia() {
        let e = calcular(Some("activo"), Some(dia("2027-01-01")), dia("2026-11-12"), true, Some("suspendido"));
        assert_eq!((e.estado, e.motivo_bloqueo.as_deref()), ("bloqueado", Some("suspendido")));
    }

    #[test]
    fn el_bloqueo_no_depende_de_tener_red() {
        // Nada en `calcular` consulta la red: con la fecha descargada y el reloj basta.
        // Última descarga con 2 días de gracia; pasan 2 días sin red: queda bloqueado.
        assert_eq!(con_corte("activo", "2026-11-10", "2026-11-12").estado, "en_gracia");
        assert_eq!(con_corte("activo", "2026-11-10", "2026-11-14").estado, "bloqueado");
    }
}
