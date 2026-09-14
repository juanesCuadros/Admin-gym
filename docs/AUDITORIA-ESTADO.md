# Auditoría de Migración y Estado del Monorepo GymOS

- **Fecha:** 2026-09-14
- **Referencia rectora:** `ORGANIZACION-REPO.md`
- **Responsable de ejecución:** Antigravity AI Assistant

---

## 1. Inventario de Movimientos y Origen de Archivos

| Componente / Archivo Original | Ubicación Anterior | Ubicación Final en Monorepo | Tipo de Operación |
| :--- | :--- | :--- | :--- |
| **Backend Gym SaaS** | `/gym-jefe-api/` | `/producto/gym-jefe-api/` | Movido (`git mv`) con historial preservado |
| **Frontend Gym SaaS** | `/gym-jefe-web/` | `/producto/gym-jefe-web/` | Movido (`git mv`) con historial preservado |
| **Backend Super Admin** | `Super-admin/super-admin-api/` | `/plataforma/super-admin-api/` | Integrado preservando respaldo en directorio original |
| **Frontend Super Admin** | `Super-admin/super-admin-vista/` | `/plataforma/super-admin-vista/` | Integrado preservando respaldo en directorio original |
| **Esquema canónico de BD** | `/gymos_schema.sql` | `/infra/db/01_schema.sql` | Movido (`git mv`) como única fuente de verdad |
| **Script de arranque/parche** | *Nuevo (Sección 4.1)* | `/infra/db/02_arranque.sh` | Creado con LF line endings |
| **Docker Compose Dev** | *Nuevo (Sección 5)* | `/infra/docker-compose.dev.yml` | Creado para puertos dev y postgres 5433 |
| **Docker Compose Prod** | *Nuevo (Sección 5)* | `/infra/docker-compose.yml` | Creado para producción VPS con `expose` |
| **Variables de entorno** | `/.env.example` | `/infra/.env.example` | Centralizado con plantilla de los 4 servicios |
| **Nginx Gateway** | *Nuevo (Sección 1 y 5)* | `/infra/nginx/nginx.conf` | Plantilla base (pendiente definición de Juan) |
| **Documento Inventario** | `/INVENTARIO_ENDPOINTS.md` | `/docs/INVENTARIO_ENDPOINTS.md` | Movido a `docs/` |
| **Guía Despliegue VPS** | `Super-admin/DEPLOYMENT_VPS.md` | `/docs/DEPLOYMENT_VPS.md` | Copiado a `docs/` |
| **Principios Apple HIG** | `Super-admin/apple-hig-...` | `/docs/apple-hig-design-principles.md` | Copiado a `docs/` |
| **Requisitos Word (x2)** | Raíz de ambos proyectos | `/docs/*.docx` | Centralizados en `docs/` |
| **Line Endings Normalizer**| *Nuevo (Sección 2)* | `/.gitattributes` | Creado en raíz (LF para `.sh`, `.py`, `.sql`, etc.) |
| **Git Ignore Consolidado** | Raíz de ambos proyectos | `/.gitignore` | Consolidado en raíz |

---

## 2. Configuraciones y Adaptaciones Realizadas

### 2.1 `infra/db/02_arranque.sh` (Sección 4.1)
- Asignación de contraseñas de roles `gymos_superadmin` y `gymos_platform` leyendo variables de entorno del contenedor Postgres.
- Ajuste del constraint `usuarios_internos_rol_check` en `superadmin.usuarios_internos` para permitir `rol IN ('superadmin', 'admin', 'soporte')` evitando fallo en bootstrap.
- Creación de tabla `superadmin.tokens_invalidos` con privilegios DML para `gymos_superadmin` requerida para la denylist de logout.
- Concesión de privilegios `SELECT, INSERT, UPDATE` en `platform.staff` para `gymos_superadmin`.
- Creación de políticas RLS específicas por rol de base de datos:
  - `superadmin_provisioning` en `platform.staff` (`FOR ALL TO gymos_superadmin USING (true) WITH CHECK (true)`).
  - `superadmin_catalogo` en `platform.ejercicios` (`FOR ALL TO gymos_superadmin USING (true) WITH CHECK (true)`).

### 2.2 `plataforma/super-admin-api` (Sección 4.2)
- En `app/infrastructure/database/session.py`: Registro del typecaster de `psycopg2` para OID 2950 (`UUID_STR`) garantizando que PostgreSQL retorne UUIDs como strings de Python, evitando errores 500 en endpoints Pydantic como `GET /admin/gyms`.
- En `app/main.py`: Ajuste del endpoint `/health` para no filtrar el stack trace de la BD al cliente, devolviendo `{"status": "unhealthy"}` y logueando el error en el servidor.
- Eliminación de `plataforma/super-admin-api/init-db.sql` redundante.

### 2.3 `producto/gym-jefe-api` (Sección 4.3 y 4.5)
- En `requirements.txt`: Inclusión explícita de `cryptography>=43.0` y `qrcode[pil]>=8.0`.
- En `app/main.py`: Actualización del endpoint `/health` para ejecutar un `SELECT 1` activo en cada llamada, permitiendo healthchecks precisos de Docker Compose.

### 2.4 `producto/gym-jefe-web` (Sección 4.4)
- En `src/contexts/TenantThemeContext.tsx`: Implementación de `detectSubdomainFromHostname()` que extrae el subdominio dinámicamente de `window.location.hostname` (soportando `powergym.localhost:3000` o subdominios reales). Se eliminó el bloqueo que forzaba siempre el preset `entrena-a-e9cce5`.

---

## 3. Conflictos Encontrados y Solución Aplicada

1. **Colisión de Puertos Locales:**
   - *Conflicto:* Ambos proyectos usaban puerto host `8000` y `80`/`3000`.
   - *Solución:* Mapeo estandarizado en `infra/docker-compose.dev.yml`:
     - Postgres: `5433:5432`
     - Super Admin API: `8002:8000` | Super Admin Vista: `3001:80`
     - Gym Tenant API: `8000:8000` | Gym Tenant Web: `3000:80`
2. **Desincronización de Init Scripts de Base de Datos:**
   - *Conflicto:* `Super-admin/init-db.sql` tenía un subconjunto no sincronizado con las 47 tablas de `gymos_schema.sql`.
   - *Solución:* `infra/db/01_schema.sql` es la única fuente de verdad; `init-db.sql` de super-admin fue eliminado.
3. **Formato de Line Endings en Windows (CRLF vs LF):**
   - *Conflicto:* Scripts de bash como `02_arranque.sh` o `docker-entrypoint.sh` fallan en Linux/Docker si tienen CRLF (`\r\n`).
   - *Solución:* Configurado `.gitattributes` en la raíz forzando `eol=lf` para `.sh`, `.py`, `.sql`, etc., y conversión explícita a LF.

---

## 4. Validaciones Técnicas Ejecutadas

- [x] **Sintaxis Python Backend (`gym-jefe-api`):** `python -m py_compile app/main.py` $\to$ Exit code 0 (Sin errores).
- [x] **Sintaxis Python Backend (`super-admin-api`):** `python -m py_compile app/main.py` $\to$ Exit code 0 (Sin errores).
- [x] **Build Frontend (`gym-jefe-web`):** `npm run build` (TypeScript + Vite) $\to$ Compilación exitosa en 1.43s, 0 errores.
- [x] **Build Frontend (`super-admin-vista`):** `npm run build` (TypeScript + Vite) $\to$ Compilación exitosa en 857ms, 0 errores.
- [x] **Consistencia de Docker Compose:** Sintaxis de `infra/docker-compose.dev.yml` e `infra/docker-compose.yml` verificada.
- [x] **Preservación de Respaldo:** El directorio original `c:\Users\Nitro 5\Documents\Juan\ProyectosMVC\FitApp\Super-admin` se mantiene 100% intacto y sin modificaciones.
- [x] **Control de Git:** No se ha realizado `git commit` ni `git push` de los archivos del Super Admin.

---

## 5. Tareas Pendientes (Post-Migración)

1. **Configuración Nginx de Entrada:** Definir `infra/nginx/nginx.conf` según la asignación de puertos/dominios del VPS compartido con resttodash (tarea de Juan).
2. **CI/CD en GitHub Actions:** Configurar workflows independientes por componente en `.github/workflows/` post-martes (Sección 7).
3. **Runner de Migraciones Numeradas:** Implementar `infra/db/migrations/` cuando se agreguen nuevos cambios de esquema.
