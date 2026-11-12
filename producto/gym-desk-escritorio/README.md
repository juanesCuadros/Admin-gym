# GymDesk Escritorio

Estación de recepción para Windows que funciona sin internet. Alcance, fases y pendientes:
[`docs/ALCANCE_APP_ESCRITORIO.md`](../../docs/ALCANCE_APP_ESCRITORIO.md).

**Estado:** fase 0 (base). La app abre, crea su base local cifrada y muestra "Estación sin activar". El ingreso del
personal y el bloqueo están construidos y probados, pero no se ven en pantalla hasta que exista la activación (fase 1),
porque sin ella la estación no tiene personal.

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
npm install
npm run app:dev      # abre la app en modo desarrollo
npm run build        # compila la interfaz (tsc + vite)
npm test             # pruebas de la interfaz (vitest)
cd src-tauri; cargo test   # pruebas del núcleo contra una base SQLCipher real
npm run app:build    # genera el instalador en src-tauri/target/release/bundle/nsis/
```

## Estructura

| Ruta | Contenido |
|---|---|
| `src/api/*.service.ts` | Única puerta de la interfaz hacia los comandos de Rust |
| `src/pages/` | Pantallas: sin activar, ingreso, bloqueo, inicio, error de arranque |
| `src-tauri/src/db/` | Base SQLCipher, clave protegida con DPAPI y migraciones locales |
| `src-tauri/src/sesion/` | Contraseña y PIN (Argon2id), bloqueo por intentos y por inactividad |
| `src-tauri/src/auditoria.rs` | Auditoría local de solo inserción con cadena de hash |
| `src-tauri/src/reloj.rs` | Hora de la estación; la fecha de negocio es la de America/Bogota |

Los componentes base (`Button`, `Input`, avisos) y los estilos se importan de `gym-jefe-web` con el alias `@web`; no se
copian.

## Datos en el equipo

`%APPDATA%\com.gymdeskcolombia.escritorio\`

- `gymdesk.db`: base cifrada. No abre con un visor de SQLite.
- `clave.bin`: clave de cifrado protegida con DPAPI; solo la abre la cuenta de Windows que instaló la app.

Si se borra `clave.bin`, la base queda ilegible y la app lo informa en vez de crear una base nueva.

## Reglas del esquema local

Cada cambio va en un archivo nuevo en `src-tauri/src/db/migraciones/` y se registra en `migraciones.rs`. Los archivos
ya publicados no se editan: las estaciones instaladas ya los aplicaron.
