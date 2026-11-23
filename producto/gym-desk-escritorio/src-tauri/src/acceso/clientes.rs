//! Módulo Clientes de la estación: la lista completa con búsqueda y filtro por estado, y la ficha de
//! cada cliente. Todo con los datos locales, con red o sin ella.

use chrono::NaiveDate;
use rusqlite::Connection;
use serde::Serialize;

use super::registro::{evaluar_cliente, plano, ClienteEvaluado};
use crate::error::{ErrorApp, Resultado};

#[derive(Debug, Clone, Serialize)]
pub struct PaginaClientes {
    pub items: Vec<ClienteEvaluado>,
    pub total: usize,
    /// Cuántos hay en cada estado, para los filtros (sobre lo que coincide con el texto).
    pub por_estado: Vec<(String, usize)>,
}

/// `filtro`: un estado del cliente, `por_cobrar` (vencido, en gracia, por vencer o sin membresía) o vacío (todos).
pub fn listar(conn: &Connection, texto: &str, filtro: &str, hoy: NaiveDate, limite: usize, desde: usize) -> Resultado<PaginaClientes> {
    let buscado = plano(texto.trim());
    let palabras: Vec<&str> = buscado.split_whitespace().collect();
    let mut candidatos: Vec<(String, String)> = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT id, nombre, documento FROM deportistas WHERE eliminado = 0")?;
        let filas = stmt.query_map([], |f| Ok((f.get::<_, String>(0)?, f.get::<_, String>(1)?, f.get::<_, String>(2)?)))?;
        for fila in filas {
            let (id, nombre, documento) = fila?;
            let (doc, nom) = (plano(&documento), plano(&nombre));
            if buscado.is_empty() || doc.starts_with(&buscado) || palabras.iter().all(|p| nom.contains(p)) {
                candidatos.push((nom, id));
            }
        }
    }
    candidatos.sort();
    // Sin filtro de estado solo se evalúa la página que se va a mostrar: evaluar a todos es lento con
    // miles de clientes. Los conteos por estado se calculan solo al filtrar.
    if filtro.is_empty() || filtro == "todos" {
        let total = candidatos.len();
        let mut items = Vec::new();
        for (_, id) in candidatos.into_iter().skip(desde).take(limite.clamp(1, 200)) {
            if let Some(c) = evaluar_cliente(conn, &id, hoy)? {
                items.push(c);
            }
        }
        return Ok(PaginaClientes { items, total, por_estado: vec![("todos".into(), total)] });
    }
    let mut conteo: std::collections::BTreeMap<String, usize> = Default::default();
    let mut filtrados = Vec::new();
    for (_, id) in candidatos {
        let Some(c) = evaluar_cliente(conn, &id, hoy)? else { continue };
        *conteo.entry(c.estado.to_string()).or_default() += 1;
        let pasa = match filtro {
            "" | "todos" => true,
            "por_cobrar" => matches!(c.estado, "vencido" | "en_gracia" | "por_vencer" | "sin_membresia"),
            e => c.estado == e,
        };
        if pasa {
            filtrados.push(c);
        }
    }
    let total = filtrados.len();
    let items = filtrados.into_iter().skip(desde).take(limite.clamp(1, 200)).collect();
    Ok(PaginaClientes { items, total, por_estado: conteo.into_iter().collect() })
}

#[derive(Debug, Clone, Serialize)]
pub struct IngresoFicha {
    pub ocurrido_en: String,
    pub resultado: String,
    pub metodo: String,
    pub mensaje: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CobroFicha {
    pub ocurrido_en: String,
    pub concepto: String,
    pub monto: i64,
    pub metodo: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FichaCliente {
    pub cliente: ClienteEvaluado,
    /// Últimos ingresos registrados en esta estación.
    pub ingresos: Vec<IngresoFicha>,
    /// Membresías y ventas cobradas a este cliente en esta estación.
    pub cobros: Vec<CobroFicha>,
    pub huellas: Vec<String>,
    pub membresia_desde: Option<String>,
    /// Grupo sanguíneo, condiciones médicas y contacto de emergencia (JSON), si los registraron.
    pub salud: Option<serde_json::Value>,
}

pub fn ficha(conn: &Connection, deportista_id: &str, hoy: NaiveDate) -> Resultado<FichaCliente> {
    let cliente = evaluar_cliente(conn, deportista_id, hoy)?
        .ok_or_else(|| ErrorApp::nuevo("CLIENTE_NO_ENCONTRADO", "Ese cliente no está en esta estación."))?;
    let ingresos = {
        let mut stmt = conn.prepare(
            "SELECT ocurrido_en, resultado, metodo, mensaje FROM ingresos WHERE deportista_id = ?1 ORDER BY ocurrido_en DESC LIMIT 15",
        )?;
        let filas = stmt.query_map([deportista_id], |f| {
            Ok(IngresoFicha { ocurrido_en: f.get(0)?, resultado: f.get(1)?, metodo: f.get(2)?, mensaje: f.get(3)? })
        })?;
        filas.collect::<Result<Vec<_>, _>>()?
    };
    let cobros = {
        let mut stmt = conn.prepare(
            "SELECT ocurrida_en, CASE tipo WHEN 'venta' THEN 'Venta de plan ' ELSE 'Renovación ' END || plan_nombre
                    || ' (hasta ' || fecha_vencimiento_nueva || ')', precio_cobrado, metodo
             FROM caja_pagos_membresia WHERE deportista_id = ?1
             UNION ALL
             SELECT v.ocurrida_en, (SELECT group_concat(i.descripcion, ', ') FROM caja_venta_items i WHERE i.venta_id = v.id), v.total, v.metodo
             FROM caja_ventas v WHERE v.deportista_id = ?1
             ORDER BY 1 DESC LIMIT 15",
        )?;
        let filas = stmt.query_map([deportista_id], |f| {
            Ok(CobroFicha { ocurrido_en: f.get(0)?, concepto: f.get::<_, Option<String>>(1)?.unwrap_or_default(), monto: f.get(2)?, metodo: f.get(3)? })
        })?;
        filas.collect::<Result<Vec<_>, _>>()?
    };
    let membresia_desde: Option<String> = conn
        .query_row(
            "SELECT fecha_inicio FROM membresias WHERE deportista_id = ?1 AND cancelada = 0 ORDER BY fecha_vencimiento DESC, created_at DESC LIMIT 1",
            [deportista_id],
            |f| f.get(0),
        )
        .ok();
    let salud: Option<String> = conn.query_row("SELECT salud FROM deportistas WHERE id = ?1", [deportista_id], |f| f.get(0)).unwrap_or(None);
    let salud = salud.and_then(|s| serde_json::from_str(&s).ok());
    Ok(FichaCliente { cliente, ingresos, cobros, huellas: crate::huella::dedos_de(conn, deportista_id)?, membresia_desde, salud })
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use crate::db::pruebas::base_temporal;
    use crate::sync::descarga::aplicar_pagina;
    use crate::sync::pruebas_util::{fila_gimnasio, pagina};
    use serde_json::json;

    #[test]
    fn lista_con_busqueda_filtro_y_ficha() {
        let (_d, conn) = base_temporal();
        let ahora: chrono::DateTime<chrono::Utc> = "2026-11-12T15:00:00Z".parse().unwrap();
        let dep = |id: &str, nombre: &str, doc: &str| json!({ "id": id, "tipo_documento": "CC", "documento": doc, "nombre": nombre, "activo": true, "eliminado": false });
        let memb = |id: &str, d: &str, vence: &str| json!({ "id": id, "deportista_id": d, "plan_id": "mes", "fecha_inicio": "2026-10-01",
                                                           "fecha_vencimiento": vence, "cancelada": false, "created_at": "2026-10-01T15:00:00Z" });
        let cambios = json!({
            "gimnasio": [fila_gimnasio()],
            "planes": [{ "id": "mes", "nombre": "Mensual", "precio": 80000, "duracion_dias": 30, "tipo": "individual", "cupo_personas": 1, "activo": true }],
            "deportistas": [dep("a", "Ana Ruiz", "1001"), dep("b", "Beto Gil", "1002"), dep("c", "Carla Díaz", "2003")],
            "membresias": [memb("ma", "a", "2026-12-20"), memb("mb", "b", "2026-11-01")],
        });
        aplicar_pagina(&conn, ahora, &pagina("c1", false, cambios)).unwrap();
        let hoy: NaiveDate = "2026-11-12".parse().unwrap();

        let todos = listar(&conn, "", "", hoy, 50, 0).unwrap();
        assert_eq!(todos.items.iter().map(|c| c.nombre.as_str()).collect::<Vec<_>>(), vec!["Ana Ruiz", "Beto Gil", "Carla Díaz"]);
        let cobrar = listar(&conn, "", "por_cobrar", hoy, 50, 0).unwrap();
        assert_eq!(cobrar.items.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), vec!["b", "c"]);
        assert_eq!(listar(&conn, "carla", "", hoy, 50, 0).unwrap().total, 1);
        assert_eq!(listar(&conn, "100", "", hoy, 50, 0).unwrap().total, 2);
        assert_eq!(listar(&conn, "", "activo", hoy, 50, 0).unwrap().total, 1);
        // Sin filtro, pagina sin evaluar a todos.
        let p = listar(&conn, "", "", hoy, 2, 1).unwrap();
        assert_eq!((p.total, p.items.iter().map(|c| c.id.as_str()).collect::<Vec<_>>()), (3, vec!["b", "c"]));

        let f = ficha(&conn, "a", hoy).unwrap();
        assert_eq!((f.cliente.nombre.as_str(), f.membresia_desde.as_deref()), ("Ana Ruiz", Some("2026-10-01")));
        assert!(f.ingresos.is_empty() && f.cobros.is_empty() && f.huellas.is_empty());
    }
}
