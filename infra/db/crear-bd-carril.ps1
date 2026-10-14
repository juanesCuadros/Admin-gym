# Crea (o recrea) una base de datos aislada para un carril de desarrollo, dentro del
# Postgres del compose dev (infra/docker-compose.dev.yml), con el esquema completo.
#
#   powershell -ExecutionPolicy Bypass -File infra/db/crear-bd-carril.ps1 -Nombre gymos_c1
#
# Cada carril usa su propia base para que las pruebas de un agente no borren los datos de otro.
# Aplica: 01_schema.sql (ya incluye 001-003) + 02_arranque.sh + las migraciones >= 004 del carril.
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^gymos_[a-z0-9_]+$')][string]$Nombre,
  [string]$Contenedor = 'gymos-dev-db-1'
)
$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

function Psql([string]$db, [string]$sql) {
  docker exec $Contenedor psql -U postgres -d $db -v ON_ERROR_STOP=1 -q -c $sql
  if ($LASTEXITCODE -ne 0) { throw "Falló: $sql" }
}

Psql 'postgres' "DROP DATABASE IF EXISTS $Nombre WITH (FORCE);"
Psql 'postgres' "CREATE DATABASE $Nombre;"

docker exec $Contenedor psql -U postgres -d $Nombre -v ON_ERROR_STOP=1 -q -f /docker-entrypoint-initdb.d/01_schema.sql
if ($LASTEXITCODE -ne 0) { throw '01_schema.sql falló' }

docker exec -e POSTGRES_DB=$Nombre $Contenedor sh /docker-entrypoint-initdb.d/02_arranque.sh
if ($LASTEXITCODE -ne 0) { throw '02_arranque.sh falló' }

# Migraciones posteriores a la 003 (las de cada carril); se leen del disco del worktree.
Get-ChildItem (Join-Path $raiz 'migrations') -Filter '*.sql' |
  Where-Object { [int]($_.Name.Substring(0, 3)) -ge 4 } |
  Sort-Object Name |
  ForEach-Object {
    Get-Content $_.FullName -Raw | docker exec -i $Contenedor psql -U postgres -d $Nombre -v ON_ERROR_STOP=1 -q
    if ($LASTEXITCODE -ne 0) { throw "Migración $($_.Name) falló" }
    Write-Host "  aplicada $($_.Name)"
  }

Write-Host "Base $Nombre lista. En el .env del carril:"
Write-Host "  DATABASE_URL=postgresql+asyncpg://gymos_platform:gymos_platform_secret@localhost:5433/$Nombre"
Write-Host "  TEST_ADMIN_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5433/$Nombre"
