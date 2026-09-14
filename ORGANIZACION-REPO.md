# GymOS — Organización del monorepo

**Para:** dev backend · **Fecha:** 2026-09-14 · **Objetivo:** tener el martes 2026-09-16 un solo repo que se levanta con un `docker compose up` en el VPS, para empezar a probar allá (no es el lanzamiento).

El modelo a seguir es **`resttodash`** (`github.com/juandavidm23/Saas-resttodash.app`). Ya está en producción con la misma forma que GymOS: panel de plataforma + producto del cliente + una sola Postgres con dos roles + nginx por subdominio. No inventamos estructura: copiamos la suya.

> Lo que aquí se pide se probó el 2026-09-13 levantando ambos sistemas contra una Postgres 16 real: alta de gimnasio desde el panel → login del jefe en el sistema del gym → suspender/reactivar. Funciona con los cambios de la sección 4. Sin ellos, no arranca.

---

## 1. Estructura final

```
gymos/
├── producto/                 Lo que usan los gimnasios (hoy: repo Admin-gym)
│   ├── gym-jefe-api/           FastAPI + asyncpg, puerto 8000
│   └── gym-jefe-web/           React + Vite, nginx interno proxea /api/v1 → gym-jefe-api
│
├── plataforma/               Lo que usamos nosotros (hoy: repo GymBros-SMP)
│   ├── super-admin-api/        FastAPI + psycopg2, puerto 8000 (en host 8002)
│   └── super-admin-vista/      React + Vite, nginx interno proxea /api → super-admin-api
│
├── infra/                    Cómo corre todo. ÚNICA fuente de verdad del servidor.
│   ├── db/
│   │   ├── 01_schema.sql         ← el gymos_schema.sql de Admin-gym, sin cambios
│   │   └── 02_arranque.sh        ← parche de la sección 4.1 (lo que faltaba para arrancar)
│   ├── nginx/
│   │   └── nginx.conf            ← PENDIENTE: lo define Juan (comparte VPS con resttodash)
│   ├── docker-compose.yml        Producción (VPS)
│   ├── docker-compose.dev.yml    Desarrollo local
│   ├── .env.example
│   └── README.md
│
├── docs/
│   ├── AUDITORIA-ESTADO.md       (la del 13-sep)
│   ├── DEPLOYMENT_VPS.md         (venía en GymBros-SMP)
│   └── INVENTARIO_ENDPOINTS.md   (venía en Admin-gym)
│
├── .github/workflows/          Después del martes (ver sección 7)
├── .gitattributes
├── .gitignore
└── README.md
```

Reglas, copiadas de resttodash:

- **Cada carpeta dentro de `producto/` y `plataforma/` se despliega sola.** Tiene su propio `Dockerfile` y no importa código de la otra.
- **`infra/` es la única fuente de verdad del servidor.** Nada se edita por SSH en el VPS; se hace commit y se aplica.
- **Una sola base Postgres, un solo esquema, en `infra/db/`.** Se eliminan `plataforma/super-admin-api/init-db.sql` y la migración Alembic deja de correr (`RUN_MIGRATIONS=false`). El `.sql` de `infra/db/` es el contrato; los dos backends se adaptan a él, no al revés.
- No se crean `shared/`, `apps/`, ni DTOs compartidos. No hay tiempo y acopla dos backends que son deliberadamente distintos (async/SQL crudo vs. sync/ORM).

---

## 2. Crear el monorepo (conservando historial)

Se usa `git subtree` para que `git log` y `git blame` de los dos repos sigan existiendo. **No** copiar carpetas a mano.

```bash
# 1. Repo vacío en la cuenta juanesCuadros (la misma de Admin-gym).
#    Nota: resttodash y GymBros-SMP están en juandavidm23; al copiar sus
#    workflows después, los secretos (SSH_HOST, SSH_PRIVATE_KEY...) y el
#    login a GHCR se configuran en la cuenta nueva, no se heredan.
mkdir gymos && cd gymos
git init -b main

# 2. Line endings ANTES de traer nada. Sin esto, docker-entrypoint.sh llega
#    al contenedor con CRLF y muere con "no such file or directory" (pasó el 13-sep).
cat > .gitattributes <<'EOF'
* text=auto
*.sh  text eol=lf
*.py  text eol=lf
*.sql text eol=lf
*.yml text eol=lf
*.yaml text eol=lf
*.conf text eol=lf
Dockerfile text eol=lf
EOF
git add .gitattributes
git commit -m "chore: raíz del monorepo GymOS"

# 3. Traer los dos repos completos, cada uno bajo su prefijo
git subtree add --prefix=producto   https://github.com/juanesCuadros/Admin-gym.git   main
git subtree add --prefix=plataforma https://github.com/juandavidm23/GymBros-SMP.git main

# 4. Reubicar lo que no va dentro de producto/ ni plataforma/
mkdir -p infra/db docs
git mv producto/gymos_schema.sql            infra/db/01_schema.sql
git mv producto/INVENTARIO_ENDPOINTS.md     docs/
git mv plataforma/DEPLOYMENT_VPS.md         docs/
git mv plataforma/apple-hig-design-principles.md docs/
git rm producto/docker-compose.yml plataforma/docker-compose.yml plataforma/docker-compose.prod.yml
git rm plataforma/deploy-vps.sh
git rm plataforma/super-admin-api/init-db.sql
git rm producto/.gitignore plataforma/.gitignore producto/.env.example plataforma/.env.example plataforma/.env.production.example
# Los README de cada repo se quedan dentro de su carpeta (README de producto/ y plataforma/).

# 5. Normalizar line endings de todo lo que entró
git add --renormalize .
git commit -m "chore: reubicar esquema, docs e infra; eliminar composes y esquemas duplicados"

# 6. Subir
git remote add origin https://github.com/juanesCuadros/gymos.git
git push -u origin main
```

Después de esto **los repos `Admin-gym` y `GymBros-SMP` se archivan en GitHub** (Settings → Archive). Nadie vuelve a hacer push allá.

`.gitignore` raíz: unión de los dos existentes (`.env*` salvo `!.env.example`, `node_modules/`, `dist/`, `__pycache__/`, `.venv/`, `*.log`, `.vscode/`, `.idea/`).

---

## 3. Base de datos: una sola fuente

| | Antes | Ahora |
|---|---|---|
| Esquema | `Admin-gym/gymos_schema.sql` (47 tablas, RLS) **y** `GymBros-SMP/init-db.sql` (3 tablas platform, sin RLS) **y** Alembic (no arranca en base vacía) | `infra/db/01_schema.sql` + `infra/db/02_arranque.sh` |
| Quién lo aplica | Cada repo el suyo, a mano | Postgres al primer arranque (`/docker-entrypoint-initdb.d`), en orden alfabético |
| Cambios de esquema | Editar el `.sql` y rezar | Hasta el martes: editar `01_schema.sql` y recrear el volumen (`down -v`). Después: migraciones numeradas `NNN_*.sql` (sección 7) |

Contraseñas de los roles: `01_schema.sql` crea `gymos_superadmin` y `gymos_platform` **sin contraseña** (correcto, no se versionan secretos). `02_arranque.sh` las fija leyendo variables de entorno — ver abajo. resttodash lo hace a mano después del primer arranque y lo documenta como paso olvidable; acá lo automatizamos.

---

## 4. Cambios de código obligatorios para que arranque

Todos verificados el 13-sep. Ninguno es opcional; sin cualquiera de ellos el sistema combinado no levanta o el panel devuelve 500.

### 4.1 `infra/db/02_arranque.sh` (nuevo)

Se escribe como script `.sh` para poder leer las variables de entorno del contenedor de Postgres:

```bash
#!/bin/sh
# infra/db/02_arranque.sh — corre una sola vez, después de 01_schema.sql
set -e
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<EOF
-- Contraseñas de los roles de aplicación (vienen del .env)
ALTER ROLE gymos_superadmin PASSWORD '${GYMOS_SUPERADMIN_PASSWORD}';
ALTER ROLE gymos_platform  PASSWORD '${GYMOS_PLATFORM_PASSWORD}';

-- El bootstrap de super-admin-api inserta rol 'superadmin'; el CHECK original solo admite admin/soporte
ALTER TABLE superadmin.usuarios_internos DROP CONSTRAINT usuarios_internos_rol_check;
ALTER TABLE superadmin.usuarios_internos ADD CONSTRAINT usuarios_internos_rol_check
  CHECK (rol IN ('superadmin','admin','soporte'));

-- super-admin-api la consulta en cada request autenticado; no existía en ningún esquema
CREATE TABLE superadmin.tokens_invalidos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,
  usuario_id   uuid,
  expira_en    timestamptz NOT NULL,
  revocado_en  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON superadmin.tokens_invalidos TO gymos_superadmin;

-- El provisioning crea el jefe inicial en platform.staff
GRANT SELECT, INSERT, UPDATE ON platform.staff TO gymos_superadmin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA platform TO gymos_superadmin;

-- RLS: el WITH CHECK de tenant_isolation exige gimnasio_id = current_gimnasio_id(),
-- y super-admin-api nunca fija app.gimnasio_id → el INSERT en platform.staff falla.
-- Política POR ROL (no se toca la de los tenants): el superadmin ve y escribe todo
-- en las tablas que le corresponden, y nada más.
CREATE POLICY superadmin_provisioning ON platform.staff
  FOR ALL TO gymos_superadmin USING (true) WITH CHECK (true);
CREATE POLICY superadmin_catalogo ON platform.ejercicios
  FOR ALL TO gymos_superadmin USING (true) WITH CHECK (true);
EOF
```

### 4.2 `plataforma/super-admin-api` — uuid como texto

El ORM tipa los 30 ids como `String(36)`, pero la base (tanto `01_schema.sql` como el viejo `init-db.sql`) los define `uuid`. psycopg2 + SQLAlchemy devuelven `uuid.UUID` y todos los schemas Pydantic con `id: str` fallan con 500. **`GET /admin/gyms` (la lista principal del panel) devolvía 500 contra Postgres real.** Los 38 tests no lo ven porque corren en SQLite.

Arreglo mínimo, en `app/infrastructure/database/session.py`, después de crear `engine`:

```python
# Los ids son uuid en Postgres pero String(36) en el ORM y str en Pydantic.
# Se registra un typecaster para que psycopg2 devuelva uuid como texto.
if "psycopg2" in settings.DATABASE_URL:
    import psycopg2.extensions as _ext
    from sqlalchemy import event as _event

    _UUID_STR = _ext.new_type((2950,), "UUID_STR", lambda v, c: v)

    @_event.listens_for(engine, "connect")
    def _uuid_as_str(dbapi_conn, rec):
        _ext.register_type(_UUID_STR, dbapi_conn)
```

(El arreglo correcto a mediano plazo es `UUID(as_uuid=False)` en los modelos; no para el martes.)

Además en el mismo servicio:
- `docker-entrypoint.sh`: se queda, pero `RUN_MIGRATIONS=false` en el compose. Alembic no se borra todavía; simplemente no corre.
- `app/main.py:106-108`: `/health` no debe devolver el texto de la excepción de BD. Devolver `{"status":"unhealthy"}` y loguear el detalle.

### 4.3 `producto/gym-jefe-api` — dependencias faltantes

`requirements.txt` no declara `cryptography` ni `qrcode`, ambas importadas en producción (`core/security.py:62`, `modules/my_gym/service.py:18`). Añadir:

```
cryptography>=43.0
qrcode[pil]>=8.0
```

### 4.4 `producto/gym-jefe-web` — tenant desde el hostname

`contexts/TenantThemeContext.tsx:104-131` resuelve el subdominio desde `window.location.hostname` **pero solo si coincide con uno de 4 presets hardcodeados**. Un gimnasio dado de alta desde el panel (ej. `powergym`) no puede entrar por la web: el formulario de login envía el subdominio del preset por defecto (`entrena-a-e9cce5`).

Cambio: si `detectSubdomainFromHostname()` devuelve un valor, **usarlo siempre** como `subdominio`, con branding por defecto si no hay preset. Los presets quedan solo como tema visual, nunca como fuente del subdominio. Referencia: `producto/frontend/src/api/http-client.ts:13-35` de resttodash hace exactamente esto.

Para desarrollo local usar `http://powergym.localhost:3000` (Chrome y Edge resuelven `*.localhost` a 127.0.0.1 sin tocar `hosts`).

### 4.5 `producto/gym-jefe-api` — `/health` real

`app/main.py:63-72`: `/health` solo verifica la BD al arrancar. El `depends_on: condition: service_healthy` del compose depende de él, así que debe hacer `SELECT 1` en cada llamada.

---

## 5. `infra/docker-compose.dev.yml`

Es el que se usó el 13-sep para la prueba de punta a punta, con rutas relativas al monorepo. Puertos elegidos para no chocar con lo que ya corre en las máquinas del equipo (5432 y 8001 están ocupados).

```yaml
name: gymos-dev
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: gymos_db
      GYMOS_SUPERADMIN_PASSWORD: gymos_superadmin_secret
      GYMOS_PLATFORM_PASSWORD: gymos_platform_secret
    ports: ["5433:5432"]
    volumes:
      - ./db:/docker-entrypoint-initdb.d:ro
      - gymos_dev_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d gymos_db"]
      interval: 3s
      timeout: 3s
      retries: 20

  # ---------- plataforma ----------
  super-admin-api:
    build: ../plataforma/super-admin-api
    depends_on: { db: { condition: service_healthy } }
    environment:
      ENVIRONMENT: development
      DEBUG: "true"
      RUN_MIGRATIONS: "false"
      DATABASE_URL: postgresql+psycopg2://gymos_superadmin:gymos_superadmin_secret@db:5432/gymos_db
      JWT_SECRET_KEY: dev_solo_local_cambiar_en_vps
      FIRST_SUPERADMIN_EMAIL: admin@gymos.internal
      FIRST_SUPERADMIN_PASSWORD: ChangeMeToStrongPassword2026!
      BASE_DOMAIN: localhost
      CORS_ORIGINS: '["http://localhost:3001"]'
    ports: ["8002:8000"]
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://127.0.0.1:8000/health || exit 1"]
      interval: 5s
      timeout: 5s
      retries: 20
      start_period: 10s

  super-admin-vista:
    build: ../plataforma/super-admin-vista
    depends_on: { super-admin-api: { condition: service_healthy } }
    ports: ["3001:80"]

  # ---------- producto ----------
  # OJO: los nombres "api" y "web" no son arbitrarios: el nginx.conf interno de
  # gym-jefe-web proxea a http://api:8000 y el de super-admin-vista a
  # http://super-admin-api:8000. Si se renombra un servicio hay que tocar ese conf.
  api:
    build: ../producto/gym-jefe-api
    depends_on: { db: { condition: service_healthy } }
    environment:
      ENVIRONMENT: development
      DEBUG: "True"
      DATABASE_URL: postgresql+asyncpg://gymos_platform:gymos_platform_secret@db:5432/gymos_db
      JWT_SECRET_KEY: dev_solo_local_cambiar_en_vps_min_32_caracteres
      TIMEZONE: America/Bogota
      CORS_ORIGINS: '["http://localhost:3000"]'
      BIOMETRIC_ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000000"
    ports: ["8000:8000"]
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 5s
      timeout: 5s
      retries: 20
      start_period: 10s

  web:
    build:
      context: ../producto/gym-jefe-web
      args: { VITE_API_URL: /api/v1 }
    depends_on: { api: { condition: service_healthy } }
    ports: ["3000:80"]

volumes:
  gymos_dev_pgdata:
```

`infra/docker-compose.yml` (producción) es el mismo sin `ports` en los servicios (solo `expose`), con las variables desde `.env`, `restart: unless-stopped`, y un servicio `nginx` de entrada **que queda pendiente hasta que Juan defina el enrutamiento** (el VPS es compartido con resttodash, que ya ocupa 80/443).

`infra/.env.example`: nombres de todas las variables de los 4 servicios + las dos contraseñas de roles, sin valores reales. El `.env` real solo existe en el VPS.

---

## 6. Verificación — el PR no se mezcla hasta que esto pase

Desde `infra/`, con un volumen limpio:

```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml ps    # los 5 en "healthy"/"Up"
```

Luego, en orden (todo esto se ejecutó el 13-sep y pasó con los cambios de la sección 4):

| # | Paso | Esperado |
|---|---|---|
| 1 | `docker compose logs super-admin-api \| grep "Super Admin inicial creado"` | Bootstrap sin error de CHECK |
| 2 | Login en http://localhost:3001 con `admin@gymos.internal` | Entra, dashboard carga |
| 3 | Panel → crear gimnasio, subdominio `powergym` | 201, muestra contraseña temporal del jefe. **No 500** |
| 4 | Lista de gimnasios | Aparece PowerGym. **No 500** (era el bug uuid) |
| 5 | `psql`: `select subdominio from platform.tenant; select correo from platform.staff;` | La fila existe en ambas (RLS no bloqueó) |
| 6 | http://powergym.localhost:3000 → login con el correo del jefe + contraseña temporal | Entra al sistema del gym (era el bug del preset) |
| 7 | Panel → suspender PowerGym | En el sistema del gym la siguiente acción devuelve 403 |
| 8 | Panel → reactivar | El gym vuelve a operar |
| 9 | `git ls-files --eol \| grep crlf` | Vacío |

Si el paso 3 o 4 da 500: falta 4.2. Si el 5 no tiene fila en `staff`: falta la política RLS de 4.1. Si el 6 manda el subdominio equivocado: falta 4.4.

---

## 7. Después del martes (no bloquea, pero queda anotado)

1. **CI/CD igual a resttodash**: un workflow por carpeta desplegable (`.github/workflows/{gym-jefe-api,gym-jefe-web,super-admin-api,super-admin-vista,infra}.yml`), que compila en GitHub Actions, publica en GHCR y el VPS solo hace `pull`. Los de resttodash se copian cambiando `context`, `tags` y rutas de `paths`. Incluir el interruptor `DEPLOY_ENABLED` y el `flock` del deploy.
2. **Migraciones numeradas** en `infra/db/migrations/NNN_*.sql` con un runner único (tabla `schema_migrations`). Ahí se retira Alembic de `super-admin-api` del todo.
3. **RLS sin la puerta trasera** `OR current_gimnasio_id() IS NULL` (`01_schema.sql:1040,1051,1059`): con las políticas por rol de 4.1 ya no hace falta, y hoy es el crítico de fuga cross-tenant de la auditoría.
4. **Auditoría append-only por BD** (`REVOKE UPDATE, DELETE ON superadmin.auditoria FROM gymos_superadmin`).
5. **Tests de integración contra Postgres real** con `infra/db/` — la suite actual (SQLite) no detecta ninguno de los problemas de esta hoja.
6. El resto de `docs/AUDITORIA-ESTADO.md`.

---

## 8. Lo que NO se hace en esta tarea

- No se reescribe ningún backend ni se cambia de ORM/driver.
- No se crean `shared/`, `apps/`, ni paquetes comunes.
- No se renombran las carpetas internas (`gym-jefe-api`, `super-admin-vista`…): los Dockerfiles y nginx internos las referencian; renombrar es cosmético y puede esperar.
- No se cablean las pantallas mock de `gym-jefe-web` (Inventario, Reportes, Personal) ni los 5 flujos con 404/405 de la auditoría. Es deuda de aplicación, no de estructura, y va aparte.
- No se define el `nginx.conf` de entrada: lo decide Juan porque el VPS se comparte con resttodash.
