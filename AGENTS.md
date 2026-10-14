# Reglas para agentes de código en GymOS

Léelo completo antes de empezar. Aplica a todo agente (Antigravity, Claude Code u otro) y a todos los carriles.

## 1. Qué documento manda

| Tema | Archivo |
|---|---|
| Alcance y fases | `docs/VISION-Y-FASES.md` |
| Reglas de negocio y criterios de aceptación (CA) | `docs/requisitos_consolidados_sistema-web.md` (GW), `docs/requisitos_consolidados_superadmin.md` (SA) |
| Decisiones ya tomadas | `docs/00_decisiones-consolidacion.md` |
| Endpoints nuevos (qué recibe, qué devuelve, errores) | `docs/CONTRATOS-API.md` |
| Qué está construido y qué falta | `docs/MATRIZ_TRAZABILIDAD.md` |
| Reglas de interfaz | `docs/PROMPT-TANDA-0-1.md`, Parte A |
| Esquema de BD | `infra/db/01_schema.sql` + `infra/db/migrations/` |

Si el código contradice un requisito, manda el requisito. Si dos documentos se contradicen, o un contrato no
alcanza, **detente y pregunta**. No inventes reglas de negocio.

## 2. Forma de trabajo

1. **Primero el plan.** Antes de escribir código, entrega un plan de implementación: qué archivos tocas, qué
   endpoints o pantallas, qué tests. Espera aprobación.
2. **Solo tus archivos.** Tu prompt dice de qué carpetas eres dueño. Fuera de ellas no editas nada; si lo necesitas,
   lo anotas en el reporte. Otro agente está trabajando en paralelo en el resto.
3. **Tu rama.** Ya estás en la rama de tu carril (este worktree). No cambies de rama ni toques `main`.
4. **Un commit por punto**, en español: `tipo(alcance): descripción` (`feat`, `fix`, `refactor`, `test`).
5. **Cero datos inventados y cero mocks.** Si falta un endpoint, no lo simules: repórtalo.
6. **Todo en español:** mensajes al usuario, nombres de negocio, comentarios y commits.
7. **No reportes "listo" sin verificarte** (sección 5).

## 3. Backend

- **Base de datos propia por carril.** El Postgres de desarrollo (`gymos-dev-db-1`, puerto 5433) ya está arriba;
  **no corras `docker compose`**. Antes de correr pruebas, crea tu base:
  `powershell -ExecutionPolicy Bypass -File infra/db/crear-bd-carril.ps1 -Nombre gymos_cN` (N = tu carril).
  Pon en tu `.env` las dos URLs que imprime el script. **Nunca** uses `gymos_db`: es la de otros.
- **Esquema:** cada cambio va en una migración nueva e idempotente en `infra/db/migrations/`, **solo con los números
  de tu rango** (carril 1: 010–019, carril 2: 020–029, carril 3: 030–039). **No edites `01_schema.sql`**: lo integra
  quien une las ramas. Vuelve a correr el script para aplicar tu migración.
- **Tabla nueva en `platform` con `gimnasio_id`:** en la misma migración activa `ENABLE` y `FORCE ROW LEVEL SECURITY` y
  crea la política `tenant_isolation` igual a la de `01_schema.sql`. Sin eso, un gimnasio ve los datos de otro.
- **Valores por defecto:** nunca `valor or N` con números de configuración (`0 or 3` da 3). Usa `is not None`. Si falta
  una configuración de permisos o descuentos, se cierra (fail-closed), nunca se abre.
- **Fechas de negocio** en America/Bogota. Prohibido `date.today()` y `datetime.now()` sin zona.
- **Dinero** en COP enteros. Toda operación de dinero acepta `Idempotency-Key`.
- **Auditoría:** toda escritura sobre dinero, membresías, permisos, inventario, accesos o configuración llama al
  servicio de auditoría en la misma transacción. Nunca guardes contraseñas ni tokens en la auditoría.
- **Errores:** `{"codigo": "MAYUSCULAS", "mensaje": "...", "detalles"?: {...}}`. Recurso de otro gimnasio → 404.
- **Permisos:** cada endpoint del GW valida con `require_permission(submodulo, accion)` o `require_role`.
- **Pruebas:** pytest contra PostgreSQL real. Cada CA de tu tarea es un test.
  - GW: `producto/gym-jefe-api/tests/` (ver `conftest.py`).
  - SA: la suite actual usa SQLite en memoria y no sirve para funciones de PostgreSQL. Lo nuevo del carril 3 va en
    `plataforma/super-admin-api/tests/postgres/` contra tu base `gymos_c3`.
- Fin de línea LF (`.gitattributes`). No conviertas archivos a CRLF.

## 4. Frontend

- La Parte A de `docs/PROMPT-TANDA-0-1.md` aplica completa: formato COP y fechas de Bogotá, estados de carga, vacío y
  error, mensajes, `ConfirmDialog` y motivo en acciones destructivas, enum único del deportista, permisos en tres
  capas, formularios sin doble envío.
- Llamadas a la API solo desde `src/api/*.service.ts`. Tipos en `src/types/`.
- **Para probar en el navegador:** levanta `producto/gym-jefe-api` desde tu worktree con
  `uvicorn app.main:app --port 8010` apuntando a `gymos_db` (la base de desarrollo con datos de ejemplo; contra ella
  **no** se corre pytest) y el frontend con `VITE_API_URL=http://localhost:8010/api/v1`. El puerto 8000 puede estar
  ocupado por otro proyecto.
- Programa contra `docs/CONTRATOS-API.md`. Si el backend de un endpoint nuevo aún no está unido, deja la pantalla
  lista contra el contrato y anótalo en el reporte. No inventes respuestas.

## 5. Verificación antes de reportar

| Carril | Debe pasar |
|---|---|
| Backend GW | `pytest` completo de `producto/gym-jefe-api` contra tu base |
| Backend SA | `pytest` completo de `plataforma/super-admin-api` (incluido `tests/postgres/`) |
| Frontend | `npm run build` sin errores. Abre cada pantalla en el navegador contra el stack local y prueba el flujo principal y un error |

## 6. Reporte al terminar

```
## Carril <N> · <nombre>
Rama: <rama> · Commits: <hash> <mensaje> (uno por línea)
### Hecho
- <punto o CA> → <archivo:línea> · test <nombre> ✅
### No hecho / desviaciones
- <qué y por qué>
### Fuera de mi alcance (no lo toqué)
- <archivo:línea> <problema o cambio que necesito de otro carril>
### Migraciones
- <NNN_nombre.sql>: <qué hace>
### Cómo probarlo
<comandos exactos>
```

Al terminar, **detente**. No empieces trabajo que no esté en tu prompt.
