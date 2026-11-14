//! Regla de acceso: copia en Rust de `MembresiaDomainService.evaluar_estado_puro` del servidor
//! (`gym-jefe-api/app/modules/membresias/domain.py`). Función pura, sin base ni reloj.
//!
//! No se edita a ojo: `casos_acceso.json` lo genera el servidor desde su función y la prueba de
//! abajo exige el mismo resultado, campo por campo. Si la regla cambia allá, esa prueba falla aquí.

use chrono::NaiveDate;
use serde::Serialize;

#[derive(Debug, Clone)]
pub struct Entrada {
    pub hoy: NaiveDate,
    pub activo: bool,
    pub tiene_membresia: bool,
    pub ultima_cancelada: bool,
    pub fecha_vencimiento: Option<NaiveDate>,
    pub congelamiento_activo: bool,
    pub dias_gracia_mora: i64,
    pub dias_umbral_por_vencer: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Evaluacion {
    /// desactivado | cancelado | sin_membresia | congelado | vencido | en_gracia | por_vencer | activo
    pub estado: &'static str,
    pub dias_restantes_o_vencido: i64,
    pub permite_ingreso: bool,
    /// abrio | alerta_mora | negado
    pub resultado_acceso: &'static str,
    pub mensaje: String,
}

fn negado(estado: &'static str, dias: i64, mensaje: impl Into<String>) -> Evaluacion {
    Evaluacion { estado, dias_restantes_o_vencido: dias, permite_ingreso: false, resultado_acceso: "negado", mensaje: mensaje.into() }
}

pub fn evaluar(e: &Entrada) -> Evaluacion {
    if !e.activo {
        return negado("desactivado", 0, "Deportista desactivado por la administración");
    }
    let vencimiento = match e.fecha_vencimiento {
        Some(v) if e.tiene_membresia => v,
        _ if e.ultima_cancelada => return negado("cancelado", 0, "Membresía cancelada por la administración"),
        _ => return negado("sin_membresia", 0, "El deportista no cuenta con membresías registradas"),
    };
    if e.congelamiento_activo {
        return negado("congelado", 0, "Membresía congelada temporalmente");
    }
    if vencimiento >= e.hoy {
        let dias = (vencimiento - e.hoy).num_days();
        if dias <= e.dias_umbral_por_vencer {
            return Evaluacion {
                estado: "por_vencer",
                dias_restantes_o_vencido: dias,
                permite_ingreso: true,
                resultado_acceso: "abrio",
                mensaje: format!("Membresía próxima a vencer ({dias} días restantes)"),
            };
        }
        return Evaluacion {
            estado: "activo",
            dias_restantes_o_vencido: dias,
            permite_ingreso: true,
            resultado_acceso: "abrio",
            mensaje: "Membresía activa".into(),
        };
    }
    let mora = (e.hoy - vencimiento).num_days();
    if mora <= e.dias_gracia_mora {
        return Evaluacion {
            estado: "en_gracia",
            dias_restantes_o_vencido: mora,
            permite_ingreso: true,
            resultado_acceso: "alerta_mora",
            mensaje: format!("Membresía en periodo de gracia ({mora} días de gracia)"),
        };
    }
    negado("vencido", mora, format!("Membresía vencida hace {mora} días"))
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use serde_json::Value;

    fn fecha(v: &Value) -> Option<NaiveDate> {
        v.as_str().map(|t| t.parse().expect("fecha AAAA-MM-DD"))
    }

    #[test]
    fn da_el_mismo_resultado_que_el_servidor_en_todos_los_vectores() {
        let casos: Vec<Value> = serde_json::from_str(include_str!("casos_acceso.json")).unwrap();
        assert!(casos.len() > 400, "faltan vectores: {}", casos.len());
        let mut estados = std::collections::BTreeSet::new();
        for c in &casos {
            let entrada = Entrada {
                hoy: fecha(&c["hoy"]).unwrap(),
                activo: c["activo"].as_bool().unwrap(),
                tiene_membresia: c["tiene_membresia"].as_bool().unwrap(),
                ultima_cancelada: c["ultima_cancelada"].as_bool().unwrap(),
                fecha_vencimiento: fecha(&c["fecha_vencimiento"]),
                congelamiento_activo: c["congelamiento_activo"].as_bool().unwrap(),
                dias_gracia_mora: c["dias_gracia_mora"].as_i64().unwrap(),
                dias_umbral_por_vencer: c["dias_umbral_por_vencer"].as_i64().unwrap(),
            };
            let r = evaluar(&entrada);
            let e = &c["esperado"];
            let obtenido = (r.estado, r.dias_restantes_o_vencido, r.permite_ingreso, r.resultado_acceso, r.mensaje.as_str());
            let esperado = (
                e["estado"].as_str().unwrap(),
                e["dias_restantes_o_vencido"].as_i64().unwrap(),
                e["permite_ingreso"].as_bool().unwrap(),
                e["resultado_acceso"].as_str().unwrap(),
                e["mensaje"].as_str().unwrap(),
            );
            assert_eq!(obtenido, esperado, "caso: {c}");
            estados.insert(r.estado);
        }
        assert_eq!(estados.len(), 8, "los vectores deben pasar por los 8 estados: {estados:?}");
    }
}
