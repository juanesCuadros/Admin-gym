# GymOS — Prompts para agentes (Claude Code y Antigravity)

**Fecha:** 13-oct-2026. Cada tarea de la Parte C es un prompt **autocontenido**: se copia completo (junto con la
Parte A) y se pega en el agente. Alcance y orden: `VISION-Y-FASES.md`. Qué falta: `MATRIZ_TRAZABILIDAD.md`.

---

# Parte A · Reglas para todos los agentes (pegar siempre)

## A1. Fuentes de verdad

| Tema | Archivo que manda |
|---|---|
| Alcance y fase | `docs/VISION-Y-FASES.md` |
| Reglas de negocio y CA | `docs/requisitos_consolidados_sistema-web.md`, `docs/requisitos_consolidados_superadmin.md` |
| Decisiones ya tomadas | `docs/00_decisiones-consolidacion.md` |
| Esquema de BD | `infra/db/01_schema.sql` + `infra/db/migrations/NNN_*.sql` |
| Reglas de UI | `docs/PROMPT-TANDA-0-1.md`, Parte A (formato, estados, mensajes, enum del deportista, permisos, formularios, prohibiciones) |
| Estructura del repo | `ORGANIZACION-REPO.md` |

Si el código contradice un requisito, manda el requisito. Si dos requisitos se contradicen, **detente y reporta**:
no decidas tú.

## A2. Reglas de trabajo

1. **Solo tocas los archivos de tu lista "Puedes tocar".** Si necesitas otro, detente y repórtalo. Otro agente puede
   estar trabajando en él.
2. Trabaja en tu propia rama (`git switch -c <rama de la tarea>`), nunca directamente en `main`.
3. Un commit por punto de la tarea, mensaje en español con formato `tipo(alcance): descripción`.
4. Cero datos inventados y cero mocks. Si falta un endpoint, no lo simules: repórtalo.
5. Todo en español: código de negocio, mensajes, comentarios y commits.
6. Al terminar, **detente** y entrega el reporte (A5). No empieces la tarea siguiente.

## A3. Reglas de backend

- **Esquema:** todo cambio va en una migración nueva e idempotente `infra/db/migrations/NNN_nombre.sql`, con el
  número que te asigna la tarea, **y** el mismo cambio integrado en `01_schema.sql` para instalaciones nuevas.
- **Fechas de negocio** en America/Bogota (`datetime.now(ZoneInfo("America/Bogota")).date()`). Prohibido `date.today()`.
- **Dinero:** COP enteros. Toda operación de dinero acepta `Idempotency-Key`.
- **Auditoría:** toda escritura sobre dinero, membresías, permisos, inventario o accesos llama a `AuditService.registrar`
  en la misma transacción.
- **Errores:** `HTTPException` con `detail={"codigo": "MAYUSCULAS", "mensaje": "..."}`. Recurso de otro gimnasio → 404.
- **Permisos:** `require_permission(submodulo, accion)` en cada endpoint.
- **Pruebas:** pytest contra PostgreSQL real (`producto/gym-jefe-api/tests/conftest.py`). Cada CA de la tarea es un test.
  Corre con `timeout` y manda la salida a un archivo.
- Fin de línea LF (`.gitattributes`). No conviertas archivos a CRLF.

## A4. Reglas de frontend

- La Parte A de `docs/PROMPT-TANDA-0-1.md` aplica completa.
- Llamadas a la API solo desde `src/api/*.service.ts`.
- Estado del deportista: solo el enum consolidado (`desactivado`, `cancelado`, `sin_membresia`, `congelado`, `vencido`,
  `en_gracia`, `por_vencer`, `activo`) vía `utils/estadoDeportista.ts` y `EstadoDeportistaBadge`.
- `npm run build` debe pasar sin errores ni advertencias nuevas de TypeScript.

## A5. Reporte al terminar

```
## Tarea <ID> · <nombre>
Rama: <rama> · Commits: <hash> <mensaje> (uno por línea)
### Hecho
- <CA o punto> → <archivo:línea> · test <nombre_test> ✅
### No hecho / desviaciones
- <qué y por qué>
### Encontré fuera de mi alcance
- <archivo:línea> <problema>  (no lo arreglé)
### Cómo probarlo
<comandos exactos>
```

---

# Parte B · Reparto y orden

Hay **tres carriles** que pueden correr en paralelo porque no comparten archivos. Dentro de cada carril las tareas
van **en orden**, una a la vez.

| Carril | Agente | Tareas fase 1A (en orden) | Toca |
|---|---|---|---|
| Backend | Claude Code (sesión 1) | B1 → B2 → B3 → B4 → B5 → B6 → M1 | `producto/gym-jefe-api/`, `plataforma/super-admin-api/`, `infra/db/` |
| Infra y pruebas | Claude Code (sesión 2) | I1 → Q1 | `infra/docker-compose.yml`, `infra/nginx/`, `infra/backups/`, `docs/DEPLOYMENT_VPS.md` |
| Frontend | Antigravity | F1 → F2 → F3 → F4 | `producto/gym-jefe-web/` |

**Dependencias entre carriles:** F3 necesita B2 en `main`; F4 necesita B3 en `main`. Si el frontend llega antes,
hace F1 y F2 y espera.

**Números de migración reservados:** 003 = B3 (salidas) · 004 = B4 (turno único) · 005 = B6 (documento y acudiente).
006 = M1 (carga inicial). La fase 1B empieza en 007.

**Revisión:** cada rama se revisa (`/code-review` en Claude Code) antes de unirla a `main`. Juan aprueba la unión.

---

# Parte C · Tareas de la fase 1A (lanzamiento)

## B1 · Arreglos cortos del backend

**Agente:** Claude Code · **Rama:** `fix/arreglos-predespliegue` · **Depende de:** nada

**Puedes tocar:** `plataforma/super-admin-api/app/application/use_cases/gym_use_cases.py`,
`.../payment_use_cases.py`, `.../infrastructure/repositories/gym_repository.py`,
`.../presentation/api/v1/endpoints/gyms.py`, `plataforma/super-admin-api/app/main.py`,
`plataforma/super-admin-api/app/core/config.py`, `producto/gym-jefe-api/app/main.py`,
`producto/gym-jefe-api/app/core/config.py`, `producto/gym-jefe-api/app/modules/deportistas/schemas.py`,
`producto/gym-jefe-api/app/modules/deportistas/service.py`, tests nuevos.

1. Reemplaza todo `date.today()` de esos archivos por la fecha de Bogotá. En el SA crea una sola utilidad
   `hoy_bogota()` en `core/` y úsala. Test: a las 19:30 de Bogotá (00:30 UTC del día siguiente) la fecha es la de Bogotá.
2. La edad del menor (`deportistas/schemas.py:55,88`) se calcula con la fecha de Bogotá.
3. El enlace de invitación a la app (`deportistas/service.py:785`) sale de `settings.APP_URL_BASE` con el subdominio.
   Debe resultar en `https://{sub}.gymdeskcolombia.com/...`. Ningún dominio fijo en el código.
4. `/docs`, `/redoc` y `/openapi.json` solo se exponen si `ENVIRONMENT != "production"`, en las dos APIs.
5. `/health` de `gym-jefe-api` ejecuta `SELECT 1` y responde 503 si la BD no responde. El del SA ya consulta la BD:
   verifica que también responda 503.

**Hecho cuando:** los 5 puntos tienen test y la suite completa pasa.

## B2 · Un solo cálculo del estado del deportista

**Agente:** Claude Code · **Rama:** `refactor/estado-deportista-unico` · **Depende de:** B1

**Contexto:** el estado se calcula en 4 lugares con reglas distintas: `deportistas/service.py:198-249` (lista),
`:280-326` (búsqueda), `:374-411` (ficha) y `membresias/domain.py:36-151` (usado por Control de ingreso). Los tres de
Deportistas usan nombres prohibidos (`al_dia`, `en_mora`) e ignoran `desactivado` y `cancelado`. El frontend ya espera
el enum consolidado (`gym-jefe-web/src/utils/estadoDeportista.ts`), así que hoy los badges de Deportistas están mal.

**Puedes tocar:** `producto/gym-jefe-api/app/modules/deportistas/`, `.../membresias/domain.py`,
`.../control_ingreso/service.py`, `.../reportes/service.py` (solo si usa los nombres viejos), tests nuevos.

1. `membresias/domain.py` es la única regla. Renombra sus estados al enum consolidado del Módulo 00
   (`inactivo`→`desactivado`, `cancelada`→`cancelado`, `mora`→`en_gracia`, `al_dia`→`activo`).
2. Lista, búsqueda y ficha de Deportistas obtienen los datos con SQL y calculan el estado con esa función. Sin `CASE`
   de estado en SQL.
3. El campo de respuesta se llama `estado` en los tres endpoints (lista, búsqueda, ficha) y usa solo el enum consolidado.
4. Tests: los CA1–CA4 del Módulo 00, más un test por cada uno de los 8 estados a través de `GET /deportistas` y de
   `POST /control-ingreso/checkin-manual`, que deben coincidir.
5. Busca en todo `producto/gym-jefe-api/app` los literales `al_dia`, `en_mora`, `mora` e `inactivo` aplicados al
   deportista. Ninguno debe quedar. El `al_dia` de la suscripción del gimnasio (`my_gym`) es otro enum y se queda.

**Hecho cuando:** la suite pasa y el reporte lista cada cambio de nombre en la respuesta de la API (lo necesita F3).

## B3 · Registrar salida (GW-RF-54)

**Agente:** Claude Code · **Rama:** `feat/salidas` · **Depende de:** B2 · **Migración:** `003_salidas.sql`

**Lee primero:** `docs/VISION-Y-FASES.md` §4.1 (reglas y CA1–CA4) y GW-RF-03 a 06.

**Puedes tocar:** `producto/gym-jefe-api/app/modules/control_ingreso/`, `.../modules/pantalla_tv/service.py` (solo
para asegurar que no emite salidas), `infra/db/01_schema.sql`, `infra/db/migrations/003_salidas.sql`, tests nuevos.

1. Migración: en `platform.checkins` agrega `salida_ts_utc timestamptz` y `salida_registrada_por uuid` (FK a staff).
   CHECK: solo un `tipo='ingreso'` con resultado `abrio` o `alerta_mora` puede tener salida, y `salida_ts_utc > ts_utc`.
   Índice parcial para "adentro": `(gimnasio_id, ts_utc) WHERE salida_ts_utc IS NULL AND tipo='ingreso'`.
2. `POST /control-ingreso/salida` con `{deportista_id}`: cierra el ingreso permitido más reciente de **hoy (Bogotá)**
   sin salida. Usa `FOR UPDATE`. Si no hay ninguno → 409 `SIN_INGRESO_ABIERTO`. Audita `REGISTRAR_SALIDA`.
3. `GET /control-ingreso/adentro`: ingresos permitidos de hoy sin salida, con nombre, documento, hora de ingreso y
   minutos transcurridos.
4. `GET /control-ingreso/ingresos-hoy` agrega a cada fila `salida_ts` y `permanencia_minutos`, y a las métricas
   `adentro_ahora`.
5. Permiso: `require_permission("control_ingreso", "crear")` para registrar; `"leer"` para consultar.
6. Tests: CA1–CA3 de §4.1, doble salida → 409, cortesía no admite salida, otro gimnasio → 404, la Pantalla TV no
   recibe evento de salida.

**Hecho cuando:** la suite pasa y el reporte incluye el contrato JSON exacto de los 3 endpoints (lo necesita F4).

## B4 · Un solo turno abierto por gimnasio (GW-RF-08)

**Agente:** Claude Code · **Rama:** `fix/turno-unico-gimnasio` · **Depende de:** B3 · **Migración:** `004_turno_unico.sql`

**Lee primero:** GW-RF-08 a 10 y la decisión P-11/P-13.

**Puedes tocar:** `producto/gym-jefe-api/app/modules/caja/`, `infra/db/01_schema.sql`,
`infra/db/migrations/004_turno_unico.sql`, tests nuevos.

1. Reemplaza `ux_turno_abierto_por_staff` (`01_schema.sql:557`) por un índice único `(gimnasio_id) WHERE estado='abierto'`.
   La migración falla con un mensaje claro si hoy hay más de un turno abierto en un gimnasio: no cierres turnos tú.
2. Abrir turno con otro turno abierto → 409 `TURNO_AJENO_ABIERTO`, con quién lo abrió y desde cuándo.
3. Cierre de turno ajeno: cualquier recepcionista con permiso de caja puede cerrar el turno abierto por otra persona,
   con el conteo. El descuadre queda atribuido a quien **abrió** el turno; se guarda también quién lo cerró. Audita
   `CERRAR_TURNO_AJENO`.
4. Revisa `cerrar_turno_forzado` (`caja/service.py:206`): si queda redundante, elimínalo y anótalo en el reporte.
5. Tests: dos aperturas simultáneas → una sola gana; cierre ajeno con descuadre atribuido a quien abrió; cobrar sin
   turno → 409.

## B5 · Regla C2 de renovación (GW-RF-25 CA2)

**Agente:** Claude Code · **Rama:** `fix/regla-c2` · **Depende de:** B4

**Puedes tocar:** `producto/gym-jefe-api/app/modules/caja/service.py` (solo el cálculo de fechas del pago de membresía,
`:715-740`), `.../membresias/domain.py` (si pones ahí la función pura), tests nuevos.

1. Al renovar una membresía en gracia o vencida: si hubo un check-in permitido entre `venc+1` y `venc+g` (fechas Bogotá),
   el nuevo periodo empieza en `venc + 1`; si no, empieza el día de la renovación. Una vigente sigue sumando desde `venc`.
2. Hazlo como función pura testeable sin BD, más un test de integración.
3. Tests: los tres CA de C2 (con g = 3) del requisito, más renovar vigente.

## B6 · Tipo de documento, acudiente y versión del consentimiento

**Agente:** Claude Code · **Rama:** `feat/registro-deportista-completo` · **Depende de:** B5 · **Migración:** `005_documento_acudiente.sql`

**Valores por defecto (Juan puede cambiarlos antes de lanzar la tarea):** tipos `CC`, `TI`, `CE`, `PAS`, `PPT`, `RC`.
Acudiente: nombre, tipo y número de documento, teléfono y parentesco, más la casilla de autorización.

**Puedes tocar:** `producto/gym-jefe-api/app/modules/deportistas/`, `infra/db/01_schema.sql`,
`infra/db/migrations/005_documento_acudiente.sql`, tests nuevos.

1. `deportistas.tipo_documento` (los existentes quedan como `CC`). La unicidad pasa a `(gimnasio_id, tipo_documento, documento)`.
2. Campos del acudiente y `acudiente_autoriza boolean`. Menor de 18 (fecha de Bogotá) exige todos y la autorización.
3. `consentimiento_version text` y `consentimiento_registrado_por uuid`. La versión vigente del texto se lee de configuración.
4. Tests: GW-RF-17 CA1 y CA4, GW-RF-19 CA2.

## I1 · Despliegue en el VPS

**Agente:** Claude Code (con Juan presente: necesita acceso al VPS y al DNS) · **Rama:** `infra/despliegue-vps`

**Contexto:** el VPS es compartido con `resttodash`, que tiene su **propio nginx en un contenedor** y ocupa los puertos
80 y 443. GymOS no publica puertos: se conecta a la red Docker de ese nginx. El DNS está en Hostinger y lo maneja Juan.

**Puedes tocar:** `infra/docker-compose.yml`, `infra/nginx/`, `infra/backups/` (nuevo), `infra/.env.prod.example`
(nuevo), `docs/DEPLOYMENT_VPS.md`. **No toques nada de resttodash sin mostrarle el cambio a Juan primero.**

1. `docker-compose.yml` de producción: sin puertos publicados, red externa compartida con el nginx de resttodash,
   variables `EMAIL_MODO`, `RESEND_API_KEY`, `APP_URL_BASE`, `ENVIRONMENT=production`, healthchecks.
2. `infra/nginx/gymos.conf`: el bloque que se agrega al nginx de resttodash. Incluye el subdominio del cliente, el SA y
   el WebSocket de la Pantalla TV (`Upgrade`/`Connection`).
3. Certificados: uno por subdominio con HTTP-01 para el cliente (el comodín queda para la fase 2).
4. Respaldo diario de la BD con `pg_dump`, rotación de 14 días, copia fuera del VPS y una restauración probada.
5. Alerta por correo a Juan si `/health` de cualquiera de las dos APIs falla dos veces seguidas.
6. Reescribe `docs/DEPLOYMENT_VPS.md` para el monorepo: primer despliegue, actualización, reversión y restauración.

**Hecho cuando:** Juan entra al subdominio del cliente por HTTPS, inicia sesión y la Pantalla TV conecta por `wss://`.

## M1 · Carga inicial de clientes (GW-RF-55)

**Agente:** Claude Code · **Rama:** `feat/carga-inicial` · **Depende de:** B6 · **Migración:** `006_carga_inicial.sql`

**Lee primero:** `docs/VISION-Y-FASES.md` §4.6.

**Puedes tocar:** `producto/gym-jefe-api/app/modules/carga_inicial/` (nuevo), `producto/gym-jefe-api/app/main.py`
(solo para registrar el router), `infra/db/01_schema.sql`, `infra/db/migrations/006_carga_inicial.sql`,
`docs/plantilla_carga_inicial.csv` (nuevo), tests nuevos.

1. Plantilla CSV (UTF-8 con BOM) y Excel con las columnas de §4.6.
2. `POST /carga-inicial/simular`: valida y devuelve filas válidas y errores por fila, sin guardar.
3. `POST /carga-inicial/aplicar`: todo o nada, en una transacción. Membresías con `origen='migracion'`, sin pago ni
   movimiento de caja. Solo el Jefe. Audita `CARGA_INICIAL` con el número de filas, sin datos personales.
4. Tests: CA1–CA3 de §4.6, más un archivo de 2.000 filas que cargue en menos de 30 segundos.

## Q1 · Pruebas de aceptación del flujo diario

**Agente:** Claude Code · **Rama:** `test/aceptacion-flujo-diario` · **Depende de:** todas las tareas de la fase 1A en `main`, incluida I1

**Puedes tocar:** `tests/aceptacion/` (nuevo, en la raíz del repo), `docs/REPORTE-ACEPTACION.md` (nuevo).

1. Script que recorre un día completo contra el servidor desplegado, en un gimnasio de prueba aparte: abrir caja,
   crear cliente adulto y menor, vender membresía, ingreso, salida, medidas, renovar, congelar, cortesía, anular un
   pago, cerrar caja con y sin descuadre, y revisar la Pantalla TV.
2. Ejecuta los casos de `PLAN_DE_PRUEBAS.md` de los módulos 01, 06, 07, 08 y 09 y marca cada uno ✅ o ❌.
3. Prueba de noche: un ingreso a las 19:30 de Bogotá se cuenta en el día correcto.
4. Borra el gimnasio de prueba al terminar.

**Hecho cuando:** `REPORTE-ACEPTACION.md` no tiene ❌ en casos Must. Si hay ❌, se reporta y no se arregla en esta tarea.

## F1 · Menú del lanzamiento

**Agente:** Antigravity · **Rama:** `feat/menu-lanzamiento` · **Depende de:** nada

**Puedes tocar:** `producto/gym-jefe-web/src/navegacion.ts`, `src/App.tsx`, `src/vite-env.d.ts`, `.env.example`.

1. Variable `VITE_MODULOS_ACTIVOS` (lista separada por comas de submódulos). Si está vacía, se muestra todo.
2. El menú y las rutas ocultan lo que no está en la lista. Para el lanzamiento: `control_ingreso,caja,deportistas,membresias`.
3. Una ruta oculta escrita a mano en la URL lleva a Inicio, sin pantalla de "en construcción".

## F2 · Pantalla TV en producción y huella simulada

**Agente:** Antigravity · **Rama:** `fix/tv-ws-produccion` · **Depende de:** F1

**Puedes tocar:** `producto/gym-jefe-web/src/api/pantallaTv.service.ts`, `src/pages/controlIngreso/ControlIngresoPage.tsx`.

1. La URL del WebSocket (`pantallaTv.service.ts:75-79`) se arma también cuando `VITE_API_URL` es relativa (`/api/v1`):
   usa `window.location` para el host y `wss` si la página está en `https`.
2. Quita el botón de huella simulada con UUID fijo (`ControlIngresoPage.tsx:87-92`). La huella es de la fase 3.

## F3 · Toma de medidas en la ficha del cliente

**Agente:** Antigravity · **Rama:** `feat/mediciones` · **Depende de:** B2 en `main`

**Puedes tocar:** `producto/gym-jefe-web/src/pages/deportistas/`, `src/api/deportistas.service.ts`, `src/types/`
(solo tipos de deportistas y mediciones), componentes nuevos dentro de `src/pages/deportistas/`.

1. Pestaña "Medidas" en la ficha: historial (`GET /deportistas/{id}/mediciones`) en tabla, la más reciente arriba, con
   la diferencia contra la anterior (por ejemplo "−1,5 kg").
2. Botón "Registrar medidas" (`POST /deportistas/{id}/mediciones`): fecha (hoy por defecto), peso, % de grasa, masa
   muscular, cintura, cadera, brazo, pierna y pecho, con sus unidades. Al menos un valor; el 422 del servidor se pinta
   en el campo.
3. Ajusta los tipos y los badges a los nombres de estado que entregó B2 (ver su reporte).

## F4 · Ingresos de hoy, salidas y quién está adentro

**Agente:** Antigravity · **Rama:** `feat/ingresos-hoy-salidas` · **Depende de:** B3 en `main`, F2

**Puedes tocar:** `producto/gym-jefe-web/src/pages/controlIngreso/`, `src/api/controlIngreso.service.ts` (o el
servicio existente de control de ingreso), `src/App.tsx` (solo la ruta `/control-ingreso/ingresos-hoy`), `src/types/`.

1. Reemplaza `IngresosHoyPage` (hoy `enConstruccion`) por la vista real: tabla de ingresos de hoy con hora de ingreso,
   hora de salida, permanencia y resultado; métricas arriba, incluido "Adentro ahora".
2. En Control de ingreso, un panel "Adentro ahora" (`GET /control-ingreso/adentro`) con un botón "Marcar salida" por
   persona, y la búsqueda existente con la opción de registrar salida.
3. 409 `SIN_INGRESO_ABIERTO` → mensaje fijo "Esta persona no tiene un ingreso abierto hoy".

---

# Parte D · Fase 1B (después del lanzamiento, en este orden)

Cada una se redacta como las de la Parte C cuando le toque. Fuente: `MATRIZ_TRAZABILIDAD.md`, sección final.

| ID | Trabajo | Requisitos | Carril |
|---|---|---|---|
| B7 | Regla del ancla en la fecha de corte (`cutting_date_calculator.py`) y recálculo en pagos y anulaciones | SA §3, SA-RF-17 | Backend |
| B8 | Reactivar exige pago y no reactiva al staff desactivado por el Jefe (`gym_use_cases.py:293-298`) | SA-RF-09 | Backend |
| B9 | El panel del SA usa `platform.estado_suscripcion()` en Inicio, urgencia y filtros | SA-RF-01, 02, 32 | Backend |
| B10 | Cerrar la puerta trasera de RLS (`01_schema.sql:1063,1074,1082,1086`) | SA/GW-RNF-02 | Backend |
| B11 | Copia del plan en la venta (precio, duración, beneficiarios) | GW-RF-24 CA2 | Backend |
| B12 | Parámetros faltantes del gimnasio y su uso (mínimo de congelamiento, ventana y límite de reserva) | GW-RF-48, 26, 33 | Backend |
| B13 | Descuentos y precio editable | GW-RF-53 | Backend |
| B14 | Planes grupales (paquetes) | GW-RF-52 | Backend |
| B15 | Staff con credencial temporal de 72 h y cambio obligatorio | GW-RF-39 | Backend |
| B16 | Recepcionista sin turno abierto debe abrir caja al iniciar sesión | GW-RF-00.1 CA4 | Backend + Frontend |
| B17 | Cancelación del gimnasio: exportación ZIP, enlace de 30 días, eliminación definitiva | SA-RF-30, 31 | Backend |
| B18 | SA: cookie de sesión, mensaje genérico en bloqueo, token de recuperación de 1 h, subdominio de 63 y reservados | SA-RF-00.x, 05 | Backend |
| F5 | Vistas en construcción: punto de venta, historial de turnos, rutinas asignadas, productos, movimientos de stock, reportes (3), staff, configuración (4), auditoría | Módulos 03, 05, 08, 10, 12, 13 | Frontend |

# Parte E · Fase 2 (se redacta cuando cierre la fase 1)

SA-RF-33 planes de suscripción · SA-RF-34 registro autónomo con prueba · sitio público en `gymdeskcolombia.com` ·
certificado comodín. Reglas en `VISION-Y-FASES.md` §4.2 y §4.3.
