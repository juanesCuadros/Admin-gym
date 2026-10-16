#!/bin/sh
# infra/backup/respaldo.sh — respaldo diario de la BD de GymOS (pg_dump, formato custom).
#
# Rotación local: 7 diarios + 4 semanales (el del domingo, hora de Bogotá, se guarda también como semanal).
# Copia fuera del VPS: si RCLONE_DESTINO está definido (p. ej. "drive:gymos-respaldos"), la carpeta local se
# espeja allá con `rclone sync` (los borrados de la rotación también se aplican en el destino).
#
# Uso (cron del VPS, ver docs/DEPLOYMENT_VPS.md):
#   RCLONE_DESTINO=drive:gymos-respaldos /home/deploy/gymos/infra/backup/respaldo.sh >> /home/deploy/gymos-respaldos/respaldo.log 2>&1
#
# Variables opcionales:
#   GYMOS_DIR        raíz del repo en el VPS              (por defecto: dos niveles arriba de este script)
#   RESPALDOS_DIR    carpeta local de respaldos           (por defecto: /home/deploy/gymos-respaldos)
#   RCLONE_DESTINO   remoto de rclone; vacío = sin copia externa
set -eu
umask 077

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
GYMOS_DIR=${GYMOS_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}
RESPALDOS_DIR=${RESPALDOS_DIR:-/home/deploy/gymos-respaldos}
RCLONE_DESTINO=${RCLONE_DESTINO:-}
COMPOSE="docker compose -f $GYMOS_DIR/infra/docker-compose.yml --env-file $GYMOS_DIR/infra/.env"

DIARIOS="$RESPALDOS_DIR/diarios"
SEMANALES="$RESPALDOS_DIR/semanales"
mkdir -p "$DIARIOS" "$SEMANALES"

FECHA=$(TZ=America/Bogota date +%Y-%m-%d_%H%M)
DIA_SEMANA=$(TZ=America/Bogota date +%u)   # 7 = domingo
ARCHIVO="$DIARIOS/gymos_$FECHA.dump"
TMP="$ARCHIVO.parcial"

echo "[$(TZ=America/Bogota date '+%F %T')] Inicio del respaldo → $ARCHIVO"

# Usuario y base se leen dentro del contenedor (vienen del .env), así no se parsea el .env aquí.
$COMPOSE exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$TMP"

# Un respaldo vacío o ilegible no reemplaza a nadie en la rotación.
if [ ! -s "$TMP" ]; then
  echo "ERROR: el respaldo quedó vacío" >&2
  rm -f "$TMP"
  exit 1
fi
if ! $COMPOSE exec -T db pg_restore -l < "$TMP" > /dev/null; then
  echo "ERROR: pg_restore no puede leer el respaldo" >&2
  rm -f "$TMP"
  exit 1
fi
mv "$TMP" "$ARCHIVO"

if [ "$DIA_SEMANA" = "7" ]; then
  cp "$ARCHIVO" "$SEMANALES/"
fi

# Rotación: conserva los N más recientes de cada carpeta.
rotar() {
  carpeta=$1
  conservar=$2
  ls -1t "$carpeta"/gymos_*.dump 2>/dev/null | tail -n +"$((conservar + 1))" | while read -r viejo; do
    rm -f "$viejo"
  done
}
rotar "$DIARIOS" 7
rotar "$SEMANALES" 4

if [ -n "$RCLONE_DESTINO" ]; then
  rclone sync "$RESPALDOS_DIR" "$RCLONE_DESTINO" --exclude "respaldo.log" --exclude "*.parcial"
  echo "Copia externa sincronizada en $RCLONE_DESTINO"
fi

echo "[$(TZ=America/Bogota date '+%F %T')] Respaldo OK ($(du -h "$ARCHIVO" | cut -f1))"
