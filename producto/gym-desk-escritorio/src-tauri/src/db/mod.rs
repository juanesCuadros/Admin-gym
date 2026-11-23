//! Base local de la estación: SQLite cifrado con SQLCipher.

pub mod clave;
pub mod migraciones;

use std::fs;
use std::path::Path;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection};
use serde_json::json;

use crate::auditoria::{self, Actor};
use crate::error::{ErrorApp, Resultado};
use crate::reloj::a_texto;
use clave::{ClaveBase, ProtectorClave};

pub const NOMBRE_BASE: &str = "gymdesk.db";

/// Abre (o crea) la base cifrada y deja el esquema al día.
pub fn abrir(ruta: &Path, clave: &ClaveBase, ahora: DateTime<Utc>) -> Resultado<Connection> {
    let mut conn = Connection::open(ruta)?;
    // La clave es hexadecimal generada por la app: no hay texto externo en el PRAGMA.
    conn.execute_batch(&format!("PRAGMA key = \"x'{}'\";", clave.hex().as_str()))?;

    // SQLCipher no valida la clave hasta la primera lectura.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |f| f.get::<_, i64>(0)).map_err(|e| {
        eprintln!("[base local] no abre con la clave de la estación: {e}");
        ErrorApp::nuevo(
            "BASE_LOCAL_NO_ABRE",
            "La base local de esta estación no se pudo abrir con su clave de cifrado. Contacta a soporte antes de reinstalar.",
        )
    })?;

    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
    migraciones::aplicar(&mut conn, &a_texto(ahora))?;
    asegurar_estacion(&conn, ahora)?;
    Ok(conn)
}

/// Punto de entrada del arranque: carpeta de datos, clave y base.
pub fn preparar(dir: &Path, protector: &dyn ProtectorClave, ahora: DateTime<Utc>) -> Resultado<Connection> {
    fs::create_dir_all(dir)?;
    let ruta = dir.join(NOMBRE_BASE);
    let clave = clave::obtener_o_crear(dir, protector, ruta.exists())?;
    abrir(&ruta, &clave, ahora)
}

/// Crea la fila única de la estación la primera vez, con su auditoría.
fn asegurar_estacion(conn: &Connection, ahora: DateTime<Utc>) -> Resultado<()> {
    let existe: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM estacion WHERE id = 1)", [], |f| f.get(0))?;
    if existe {
        return Ok(());
    }
    let estacion_id = uuid::Uuid::new_v4().to_string();
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO estacion (id, estacion_id, creada_en) VALUES (1, ?1, ?2)",
        params![estacion_id, a_texto(ahora)],
    )?;
    auditoria::registrar(
        &tx,
        ahora,
        Actor::sistema(),
        "CREAR_BASE_LOCAL",
        "estacion",
        Some(&estacion_id),
        &json!({ "version_app": env!("CARGO_PKG_VERSION") }),
    )?;
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
pub mod pruebas {
    use super::*;
    use crate::db::clave::pruebas::ProtectorDePrueba;
    use crate::reloj::pruebas::RelojFijo;
    use crate::reloj::Reloj;

    pub fn reloj() -> RelojFijo {
        RelojFijo::en("2026-11-12T15:00:00Z")
    }

    /// Base cifrada real en una carpeta temporal.
    pub fn base_temporal() -> (tempfile::TempDir, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let conn = preparar(dir.path(), &ProtectorDePrueba, reloj().ahora()).unwrap();
        (dir, conn)
    }

    #[test]
    fn el_primer_arranque_crea_la_base_y_la_fila_de_la_estacion() {
        let (dir, conn) = base_temporal();
        assert!(dir.path().join(NOMBRE_BASE).exists());
        let (activada, estacion_id): (Option<String>, String) = conn
            .query_row("SELECT activada_en, estacion_id FROM estacion WHERE id = 1", [], |f| Ok((f.get(0)?, f.get(1)?)))
            .unwrap();
        assert!(activada.is_none(), "una estación nueva no está activada");
        assert!(uuid::Uuid::parse_str(&estacion_id).is_ok());
    }

    #[test]
    fn la_base_en_disco_esta_cifrada() {
        let (dir, conn) = base_temporal();
        conn.execute(
            "INSERT INTO staff_local (id, nombre, correo, rol, actualizado_en) VALUES ('1', 'Nombre Visible En Claro', 'a@b.co', 'jefe', 'x')",
            [],
        )
        .unwrap();
        conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
        drop(conn);

        let bytes = fs::read(dir.path().join(NOMBRE_BASE)).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3"), "el archivo no debe ser un SQLite sin cifrar");
        let aguja = b"Nombre Visible En Claro";
        assert!(!bytes.windows(aguja.len()).any(|v| v == aguja), "los datos no deben leerse en el archivo");

        // Sin clave no abre.
        let sin_clave = Connection::open(dir.path().join(NOMBRE_BASE)).unwrap();
        assert!(sin_clave.query_row("SELECT count(*) FROM sqlite_master", [], |f| f.get::<_, i64>(0)).is_err());
    }

    #[test]
    fn con_otra_clave_la_base_no_abre() {
        let (dir, conn) = base_temporal();
        drop(conn);
        let otra = ClaveBase::desde_bytes([7u8; clave::LARGO_CLAVE]);
        let err = abrir(&dir.path().join(NOMBRE_BASE), &otra, reloj().ahora()).err().unwrap();
        assert_eq!(err.codigo, "BASE_LOCAL_NO_ABRE");
    }

    #[test]
    fn abrir_dos_veces_no_repite_migraciones_ni_la_estacion() {
        let dir = tempfile::tempdir().unwrap();
        let primera = preparar(dir.path(), &ProtectorDePrueba, reloj().ahora()).unwrap();
        let id1: String = primera.query_row("SELECT estacion_id FROM estacion", [], |f| f.get(0)).unwrap();
        drop(primera);

        let mut segunda = preparar(dir.path(), &ProtectorDePrueba, reloj().ahora()).unwrap();
        let id2: String = segunda.query_row("SELECT estacion_id FROM estacion", [], |f| f.get(0)).unwrap();
        assert_eq!(id1, id2);
        assert_eq!(migraciones::aplicar(&mut segunda, "x").unwrap(), 0);
        let n: i64 = segunda.query_row("SELECT count(*) FROM _migraciones", [], |f| f.get(0)).unwrap();
        assert_eq!(n, 9);
        let creaciones: i64 = segunda
            .query_row("SELECT count(*) FROM auditoria_local WHERE accion = 'CREAR_BASE_LOCAL'", [], |f| f.get(0))
            .unwrap();
        assert_eq!(creaciones, 1);
    }
}
