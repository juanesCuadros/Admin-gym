//! Migraciones del esquema local. Cada una se aplica una sola vez, en orden y
//! dentro de una transacción. Para cambiar el esquema se agrega un archivo nuevo;
//! los ya publicados no se editan.

use rusqlite::{params, Connection};

use crate::error::Resultado;

const MIGRACIONES: &[(u32, &str, &str)] = &[
    (1, "base", include_str!("migraciones/0001_base.sql")),
    (2, "sync", include_str!("migraciones/0002_sync.sql")),
    (3, "ingreso", include_str!("migraciones/0003_ingreso.sql")),
    (4, "caja", include_str!("migraciones/0004_caja.sql")),
    (5, "membresias", include_str!("migraciones/0005_membresias.sql")),
    (6, "fotos", include_str!("migraciones/0006_fotos.sql")),
    (7, "huellas", include_str!("migraciones/0007_huellas.sql")),
    (8, "salud", include_str!("migraciones/0008_salud.sql")),
];

pub fn aplicar(conn: &mut Connection, ahora: &str) -> Resultado<u32> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migraciones (
           numero INTEGER PRIMARY KEY,
           nombre TEXT NOT NULL,
           aplicada_en TEXT NOT NULL
         );",
    )?;

    let mut aplicadas = 0;
    for (numero, nombre, sql) in MIGRACIONES {
        let ya: bool =
            conn.query_row("SELECT EXISTS(SELECT 1 FROM _migraciones WHERE numero = ?1)", [numero], |f| f.get(0))?;
        if ya {
            continue;
        }
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO _migraciones (numero, nombre, aplicada_en) VALUES (?1, ?2, ?3)",
            params![numero, nombre, ahora],
        )?;
        tx.commit()?;
        aplicadas += 1;
    }
    Ok(aplicadas)
}
