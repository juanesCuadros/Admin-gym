# GymDesk Escritorio — Alcance, decisiones y pendientes

**Fecha:** 12-nov-2026 · **Decide:** Juan Moreno · **Rama:** `feat/escritorio` · **Ubicación:** `producto/gym-desk-escritorio/`

Este documento manda sobre el **alcance y el orden** de la app de escritorio. La especificación técnica de partida es
`ESPECIFICACION_APP_ESCRITORIO.md`; donde los dos se contradigan, manda este. Las reglas de negocio siguen en
`requisitos_consolidados_sistema-web.md` y los contratos en `CONTRATOS-API.md`.

---

## 1. Qué es y para qué

Estación de recepción para Windows que **sigue registrando ingresos y cobrando cuando se cae internet**. El primer
cliente tiene wifi inestable y hoy, si la red se cae, recepción no puede dejar entrar a nadie ni cobrar.

- Nombre visible para el usuario: **GymDesk** (no "GymOS").
- Un solo instalador para todos los gimnasios; cada estación se activa con el subdominio y un código de estación.
- El servidor sigue siendo la autoridad: todo lo hecho sin red se valida al sincronizar.

## 2. Decisiones tomadas

| # | Tema | Decisión |
|---|---|---|
| E-01 | Stack | Tauri 2 + React + TypeScript + Vite. Reemplaza la mención a Electron de `00_decisiones-consolidacion.md` |
| E-02 | Base local | SQLite cifrado con SQLCipher |
| E-03 | Sincronización | Local-first con outbox transaccional en la estación, idempotencia con UUID del cliente + clave de idempotencia, y descarga incremental |
| E-04 | Autoridad | El servidor valida todo al sincronizar |
| E-05 | Qué funciona sin red | Solo recepción: ingreso y caja. Lo demás exige conexión |
| E-06 | Hardware | Universal, sin código por marca: un trait de Rust por tipo de periférico y la implementación se elige en la pantalla de configuración de la estación |
| E-07 | Torniquete / puerta | Pulso de relé con duración configurable: relé USB, puerto serial con comando configurable, o relé de red (HTTP/TCP) |
| E-08 | Impresora | ESC/POS de 58 y 80 mm, por USB o red, con apertura de cajón |
| E-09 | Lector de código de barras / QR | Entrada tipo teclado |
| E-10 | Huella | Solo la interfaz y un controlador simulado **para pruebas automáticas**. La marca del lector no está definida (§6) |
| E-11 | Reconocimiento facial | Fuera de alcance |
| E-12 | Sesión del personal | Ingreso con PIN o contraseña. Bloqueo de pantalla a los 5 minutos sin actividad |
| E-13 | Forma de trabajo | Una fase a la vez: plan → aprobación de Juan → construcción → verificación → commit |

## 3. Fases y criterio de terminado

| Fase | Contenido | Terminado cuando |
|---|---|---|
| **0 · Base** | Proyecto Tauri, SQLite cifrado, ingreso del personal con PIN o contraseña, bloqueo por 5 min de inactividad | Se genera el `.exe`, abre y crea la base local |
| **1 · Activación y sincronización** | Emparejamiento por subdominio + código de estación. Descarga inicial: branding, permisos, parámetros, planes, productos, deportistas y membresías. Outbox con reintentos. Indicador de conexión y de pendientes. Backend: `/sync/push`, `/sync/pull`, registro de estaciones con `device_token` y RLS | 24 h sin red, se reconecta y no hay duplicados ni pérdidas |
| **2 · Ingreso sin red** | Ingreso por documento o QR y cortesía con motivo. Pantalla grande con foto, nombre, vigencia, días restantes y saldo; colores por estado (activo, gracia, vencido, congelado) y sonido. Antirrebote de 3 s | La evaluación local da el mismo resultado que `evaluar-acceso` del servidor (pruebas comparativas) |
| **3 · Caja sin red** | Abrir y cerrar turno con arqueo, venta de mostrador, cobro y renovación de membresías, pago mixto, egresos, anulaciones con motivo, cierre diario y cuadre mensual | Criterio por definir en el plan de la fase. Antes: regla para P-13 aprobada por Juan (§5, C-01) |
| **4 · Hardware** | Controladores de E-07 a E-10, cámara web para la foto y segunda pantalla de bienvenida (reutiliza `pantalla_tv`) | Criterio por definir en el plan de la fase |
| **5 · Gestión en línea** | Inventario con movimientos de stock por delta, horario del personal, medidas corporales, asistencia a clases y reportes básicos | Criterio por definir en el plan de la fase |
| **6 · Entrega** | Instalador `.exe`, actualización automática (GitHub Releases), registro de errores, respaldo de la base local y manual de instalación | Criterio por definir en el plan de la fase |

Las fases 3 a 6 no traen criterio de terminado en el encargo: se propone uno en el plan de cada fase.

## 4. Qué hay hoy en el backend (revisado el 12-nov-2026)

| Tema | Estado |
|---|---|
| Regla de acceso | `MembresiaDomainService.evaluar_estado_puro` es una función pura, sin base de datos. Es la que hay que replicar en Rust y comparar en la fase 2 |
| Antirrebote de 3 s | Existe en el servidor (`control_ingreso/service.py`), contra la hora del servidor |
| Ingresos | `platform.checkins` usa `id bigserial`, hora `now()` del servidor y `metodo` solo `huella` o `manual`. No acepta identificador ni hora del cliente |
| Turno único | Índice `ux_turno_abierto_por_gym` (migración 010) y error `TURNO_AJENO_ABIERTO` |
| Ventas y pagos de membresía | Idempotencia con el header `X-Idempotency-Key`, único por gimnasio. Un solo método de pago por venta |
| Egresos, anulaciones, abrir y cerrar turno | **Sin** clave de idempotencia |
| Huella | Tabla `platform.huellas` con `template_cifrado` y endpoints para enrolar y eliminar. No hay comparación de huellas |
| Pantalla TV | `tenant.pantalla_device_token_hash`: es el patrón a seguir para el `device_token` de la estación |
| Migraciones | La última es la 042. El rango 070–079 está libre |

## 5. Contradicciones y vacíos encontrados

Ninguno bloquea la fase 0. Cada uno se debe resolver antes de la fase que lo usa. **No se inventó ninguna regla.**

### Contradicciones entre documentos

| # | Tema | Qué choca | Fase |
|---|---|---|---|
| C-01 | Turno único (P-13) | Con la estación sin red y la web en línea pueden abrirse dos turnos. Juan pidió una propuesta y aprobarla antes de la fase 3 | 3 |
| C-02 | "Sin outbox, jobs, webhooks ni n8n" (resolución 4 de `00_decisiones`) | E-03 usa outbox. Se interpretó que la resolución 4 habla del **servidor** y que el outbox vive solo en la estación; así quedó anotado en `00_decisiones`. Confirmar | 1 |
| C-03 | Header de idempotencia | `AGENTS.md` y los requisitos dicen `Idempotency-Key`; el contrato 1.5 y el código del GW usan `X-Idempotency-Key`. Se propone usar `X-Idempotency-Key` | 1 |
| C-04 | Orden de fases | `VISION-Y-FASES.md` dice que el escritorio empieza después de que el primer cliente opere en la web. Se asume cumplido (producción desde el 16-oct). Ese documento no se editó | — |
| C-05 | Nombre | La especificación base dice "GymOS Desktop" y `GymOS-Desktop-Setup.exe`. Manda "GymDesk" | 6 |
| C-06 | Conflictos de datos | La especificación base dice *last-write-wins* para membresías y deportistas; E-04 dice que el servidor valida todo. Se asume E-04 | 1 |
| C-07 | Dinero | `AGENTS.md` pide COP enteros; el backend guarda `numeric(12,2)` y responde decimales. La estación guardará enteros y convertirá al sincronizar | 1 |

### Cosas del alcance que no existen en el backend ni en los requisitos

| # | Tema | Qué falta saber | Fase |
|---|---|---|---|
| V-01 | **PIN del personal** | `platform.staff` solo tiene contraseña. Falta: cuántos dígitos, quién lo crea, si es por estación o por gimnasio, y cómo se valida sin red (ver propuesta en el plan de la fase 0) | 0 |
| V-02 | **Foto del deportista** | No existe el campo ni dónde guardarla. La piden la pantalla de ingreso (fase 2) y la cámara (fase 4) | 2 |
| V-03 | **"Saldo" en la pantalla de ingreso** | Los requisitos dejan fuera abonos y saldo a favor. ¿Qué saldo se muestra? | 2 |
| V-04 | **QR** | No existe un código de carnet. ¿El QR contiene el documento u otro código? ¿Quién lo genera? | 2 |
| V-05 | **Pago mixto** | Una venta y un pago de membresía aceptan un solo método. Es regla nueva y cambia el contrato | 3 |
| V-06 | **Cierre diario y cuadre mensual** | No existen en caja ni en reportes. Falta definir qué muestran y quién los ve | 3 |
| V-07 | **Horario del personal** | No hay requisito ni tabla | 5 |
| V-08 | **Hora de los ingresos hechos sin red** | El servidor usa su propia hora. Al sincronizar hay que aceptar la hora de la estación, y la regla C2 de renovación depende de esa fecha. Falta decidir cuánto se confía en el reloj del equipo | 1–2 |
| V-09 | **Cuando el servidor rechaza algo ya cobrado** | Ejemplo: sin red se vende la última unidad y la web también la vendió; o se renueva una membresía que el Jefe canceló. El dinero ya se recibió. Falta la regla: ¿se acepta y se marca para revisión del Jefe, o se rechaza? | 1 y 3 |
| V-10 | **Comparación de huellas en local** | El servidor guarda el template cifrado con su propia clave. Para comparar sin red la estación necesita los templates y un motor de comparación, que depende de la marca | 4 |
| V-11 | **Salidas (GW-RF-54)** | El encargo no dice si la salida se registra sin red | 2 |
| V-12 | **Alta de cliente sin red** | La especificación base la incluye; E-05 limita lo offline a ingreso y caja. Se asume que el alta exige conexión, y por tanto no se puede vender una membresía a un cliente nuevo sin red | 3 |

## 6. Huella: cómo soportar lector sin atarse a una marca

Un trait `LectorHuella` con tres operaciones: capturar, enrolar e identificar. Opciones de implementación, a elegir
cuando se conozca el equipo:

| Opción | Cómo funciona | A favor | En contra |
|---|---|---|---|
| ZKTeco USB (SLK20R, ZK9500…) | SDK ZKFinger (DLL de Windows) enlazado desde Rust; comparación 1:N en el equipo | Barato y común en Colombia | Templates en formato propio; el SDK se instala aparte |
| DigitalPersona U.are.U 4500/5300 | SDK U.are.U (DLL); templates en formato estándar ISO/ANSI | Formato estándar, se puede cambiar de marca | Lector y licencia más caros |
| Terminal de acceso por red (ZKTeco, Hikvision, Suprema) | La terminal guarda las huellas, compara y abre la puerta sola; la estación solo recibe "entró la persona X" y le envía quién está al día | Funciona aunque el PC esté apagado; no hay que comparar huellas en la app | Hay que sincronizar altas y bloqueos hacia la terminal; cada fabricante tiene su protocolo |
| Simulado | Devuelve lo que la prueba le indique | Permite probar el flujo completo | **Solo para pruebas automáticas; no se compila en la versión que se entrega** |

Recomendación preliminar: definir el trait pensando en la terminal de red (el caso más distinto) y decidir la marca
antes de la fase 4. Guardar templates en formato estándar cuando el lector lo permita.

## 7. Requisitos del equipo de desarrollo

Revisado el 12-nov-2026 en el equipo de Juan:

| Herramienta | Estado |
|---|---|
| Node 22.22.1 y npm 10.9.4 | Instalado |
| WebView2 157 | Instalado |
| Rust (rustup, cargo, toolchain MSVC) | **Falta** |
| Visual Studio Build Tools con "Desarrollo para escritorio con C++" y Windows SDK | **Falta** |
| Perl (Strawberry Perl), para compilar OpenSSL junto con SQLCipher | **Falta** |

## 8. Fuera de alcance

Reconocimiento facial · app móvil · macOS y Linux · operación sin red de inventario, clases, medidas y reportes ·
facturación electrónica.
