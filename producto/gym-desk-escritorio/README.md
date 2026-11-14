# GymDesk Escritorio

Estación de recepción para Windows que funciona sin internet. Alcance, fases y pendientes:
[`docs/ALCANCE_APP_ESCRITORIO.md`](../../docs/ALCANCE_APP_ESCRITORIO.md). Contratos con el servidor:
[`docs/CONTRATOS-API.md`](../../docs/CONTRATOS-API.md), sección "Escritorio".

**Estado:** fase 2 (ingreso sin red). La estación se activa con el subdominio y un código, descarga los datos del
gimnasio, el personal entra con contraseña o PIN, y recepción registra ingresos y cortesías con red o sin ella. Lo que
se hace sube solo al servidor cuando hay red. La caja es la fase 3.

## Requisitos para desarrollar

| Herramienta | Para qué |
|---|---|
| Node 22 | Interfaz (React + Vite) |
| Rust estable (`rustup`, toolchain MSVC) | Núcleo de la app |
| Visual Studio Build Tools con "Desarrollo para escritorio con C++" | Enlazador y SDK de Windows |
| Strawberry Perl | Compilar OpenSSL, del que depende SQLCipher |
| WebView2 | Viene con Windows 11 |

## Comandos

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;C:\Strawberry\perl\bin;$env:Path"
npm install
npm run app:dev      # abre la app en modo desarrollo
npm run build        # compila la interfaz (tsc + vite)
npm test             # pruebas de la interfaz (vitest)
cd src-tauri; cargo test -j 3   # pruebas del núcleo contra una base SQLCipher real
npm run app:build    # genera el instalador en src-tauri/target/release/bundle/nsis/
```

### Probar contra una API local

En producción la estación habla siempre con `https://<subdominio>.gymdeskcolombia.com/api/v1`. Solo las compilaciones
de desarrollo aceptan otra dirección:

```powershell
$env:GYMDESK_API_URL = "http://127.0.0.1:8010/api/v1"
npm run app:dev
```

### Prueba de 24 horas sin red (criterio de la fase 1)

Acelerada con reloj simulado, contra la API y el PostgreSQL reales. Crea y borra un gimnasio de prueba: nunca contra
`gymos_db` ni contra producción.

```powershell
cd ..\gym-jefe-api
$env:DATABASE_URL = "postgresql+asyncpg://gymos_platform:<clave>@localhost:<puerto>/<base_de_tu_carril>"
$env:TEST_ADMIN_DATABASE_URL = "postgresql+asyncpg://postgres:<clave>@localhost:<puerto>/<base_de_tu_carril>"
.\.venv\Scripts\python.exe ..\gym-desk-escritorio\pruebas\prueba_24h.py
```

Antes de entregar a un cliente falta además una noche real sin red en una estación instalada (ver el alcance).

### Regla de acceso igual a la del servidor (criterio de la fase 2)

La estación decide el ingreso con una copia en Rust de la regla del servidor. Dos pruebas la mantienen igual:

- **Vectores compartidos.** `src-tauri/src/acceso/casos_acceso.json` lo genera el servidor desde su función; `cargo test`
  exige el mismo resultado. Si la regla cambia en el servidor, se regenera y se ajusta `acceso/regla.rs`:

  ```powershell
  cd ..\gym-jefe-api
  $env:GYMDESK_REGENERAR_VECTORES = "1"; .\.venv\Scripts\python.exe -m pytest tests\test_e8_vectores_acceso.py
  ```

- **Comparativa de punta a punta.** Crea 40 clientes en cada situación, le pregunta lo mismo a la API real y a la
  estación, y exige cero diferencias. Mismas variables que la prueba de 24 horas:

  ```powershell
  .\.venv\Scripts\python.exe ..\gym-desk-escritorio\pruebas\prueba_acceso.py
  ```

## Estructura

| Ruta | Contenido |
|---|---|
| `src/api/*.service.ts` | Única puerta de la interfaz hacia los comandos de Rust |
| `src/pages/` | Activación, descarga inicial, ingreso del personal, bloqueo, inicio, control de ingreso, pendientes, servicio no disponible |
| `src-tauri/src/acceso/regla.rs` | Regla de acceso: copia de la del servidor, función pura |
| `src-tauri/src/acceso/registro.rs` | Evalúa con los datos locales y registra ingresos y cortesías; antirrebote de 3 s |
| `src-tauri/src/db/` | Base SQLCipher, clave protegida con DPAPI y migraciones locales |
| `src-tauri/src/sesion/` | Contraseña y PIN (Argon2id), bloqueo por intentos y por inactividad |
| `src-tauri/src/sync/transporte.rs` | Todo lo que sale a la red |
| `src-tauri/src/sync/activacion.rs`, `ingreso.rs` | Activar la estación y primer ingreso validado en el servidor |
| `src-tauri/src/sync/descarga.rs` | Descarga por rondas; se aplica reemplazando por id |
| `src-tauri/src/sync/outbox.rs`, `motor.rs` | Cola de envío y ciclo de sincronización con reintentos |
| `src-tauri/src/sync/suscripcion.rs` | Aviso y bloqueo del servicio, calculados en la estación |
| `src-tauri/src/auditoria.rs` | Auditoría local con cadena de hash; cada evento se encola para subir |
| `src-tauri/src/reloj.rs` | Hora de la estación; la fecha de negocio es la de America/Bogota |

Los componentes base (`Button`, `Input`, `Badge`, avisos) y los estilos se importan de `gym-jefe-web` con el alias
`@web`; no se copian.

## Datos en el equipo

`%APPDATA%\com.gymdeskcolombia.escritorio\`

- `gymdesk.db`: base cifrada. No abre con un visor de SQLite. Guarda también el `device_token` de la estación.
- `clave.bin`: clave de cifrado protegida con DPAPI; solo la abre la cuenta de Windows que instaló la app.

Si se borra `clave.bin`, la base queda ilegible y la app lo informa en vez de crear una base nueva.

## Reglas que no se rompen

- **La cola no se borra.** `sync_outbox` conserva lo aplicado, los errores y lo que quedó por revisar.
- **Los ingresos tampoco.** Cada intento, permitido o negado, queda en `ingresos`.
- **El ingreso lo decide la estación**, con sus datos locales, con red o sin ella. No hay un segundo camino "en línea".
- **Cada cambio local y su fila en la cola van en la misma transacción.**
- **El identificador y la clave de idempotencia de una operación no cambian entre reintentos.**
- **El esquema local solo crece con archivos nuevos** en `src-tauri/src/db/migraciones/`, registrados en
  `migraciones.rs`. Los ya publicados no se editan: las estaciones instaladas ya los aplicaron.
