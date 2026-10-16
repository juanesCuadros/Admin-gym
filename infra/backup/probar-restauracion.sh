#!/bin/sh
# infra/backup/probar-restauracion.sh — restaura un respaldo en una base APARTE y la compara con la real.
# No toca la base de producción: crea `gymos_restore_prueba`, restaura, compara conteos por tabla y la borra.
#
# Uso: infra/backup/probar-restauracion.sh [archivo.dump]
#      (sin argumento usa el respaldo diario más reciente)
# Nota: si hubo escrituras entre el respaldo y la prueba, algunos conteos pueden diferir; recién hecho
#       el respaldo deben coincidir todos.
set -eu

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
GYMOS_DIR=${GYMOS_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}
RESPALDOS_DIR=${RESPALDOS_DIR:-/home/deploy/gymos-respaldos}
COMPOSE="docker compose -f $GYMOS_DIR/infra/docker-compose.yml --env-file $GYMOS_DIR/infra/.env"
PRUEBA=gymos_restore_prueba

ARCHIVO=${1:-$(ls -1t "$RESPALDOS_DIR"/diarios/gymos_*.dump 2>/dev/null | head -n 1)}
if [ -z "$ARCHIVO" ] || [ ! -s "$ARCHIVO" ]; then
  echo "ERROR: no hay respaldo para probar" >&2
  exit 1
fi
echo "Probando restauración de: $ARCHIVO"

psql_db() {
  $COMPOSE exec -T db sh -c "psql -v ON_ERROR_STOP=1 -U \"\$POSTGRES_USER\" -d $1 -At"
}

limpiar() {
  echo "DROP DATABASE IF EXISTS $PRUEBA;" | psql_db postgres > /dev/null
}
trap limpiar EXIT

limpiar
echo "CREATE DATABASE $PRUEBA;" | psql_db postgres > /dev/null
$COMPOSE exec -T db sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $PRUEBA --exit-on-error" < "$ARCHIVO"

# Conteo de filas de cada tabla de los esquemas de GymOS (como superusuario: RLS no filtra).
CONTEO="SELECT table_schema || '.' || table_name || ' ' ||
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema IN ('superadmin', 'platform') AND table_type = 'BASE TABLE'
ORDER BY 1;"

REAL=$(echo "$CONTEO" | $COMPOSE exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At')
RESTAURADA=$(echo "$CONTEO" | psql_db $PRUEBA)

TABLAS=$(echo "$RESTAURADA" | grep -c . || true)
if [ "$REAL" = "$RESTAURADA" ]; then
  echo "Restauración OK: $TABLAS tablas, todos los conteos coinciden con la base real."
else
  echo "DIFERENCIAS entre la base real (-) y la restaurada (+):" >&2
  TMPDIR_CMP=$(mktemp -d)
  echo "$REAL" > "$TMPDIR_CMP/real"
  echo "$RESTAURADA" > "$TMPDIR_CMP/restaurada"
  diff -u "$TMPDIR_CMP/real" "$TMPDIR_CMP/restaurada" >&2 || true
  rm -rf "$TMPDIR_CMP"
  exit 1
fi
