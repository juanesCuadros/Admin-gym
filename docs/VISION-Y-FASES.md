# GymOS — Visión del producto y fases

**Fecha:** 13-oct-2026 · **Decide:** Juan Moreno · **Dominio:** `gymdeskcolombia.com`

Este documento manda sobre el **alcance y el orden**. Las reglas detalladas de cada módulo siguen en
`requisitos_consolidados_superadmin.md` y `requisitos_consolidados_sistema-web.md`; lo que está construido y lo que falta, en
`MATRIZ_TRAZABILIDAD.md`. Si este documento contradice a otro en alcance o fase, manda este.

---

## 1. Qué es GymOS

SaaS multi-tenant para gimnasios en Colombia. MVC opera la plataforma desde el **Super-Admin (SA)**; cada gimnasio
opera desde el **Sistema Web (GW)** en su subdominio `{sub}.gymdeskcolombia.com`.

| Pieza | Para quién | Dónde |
|---|---|---|
| Super-Admin | Equipo MVC | `admin.gymdeskcolombia.com` (propuesta) |
| Sistema Web | Jefe, recepción y entrenadores de cada gimnasio | `{sub}.gymdeskcolombia.com` |
| Pantalla TV | Monitor de recepción | Modo de Control de ingreso |
| Sitio público de GymOS | Gimnasios interesados (registro con prueba) | `gymdeskcolombia.com` |

---

## 2. Fases

| Fase | Objetivo | Sale cuando |
|---|---|---|
| **1 · Lanzamiento con el primer cliente** | El cliente opera de verdad, con dinero real, desde el primer día | Se cumplen las condiciones de salida (§6.1) y el cliente termina la migración en máximo 4 días (§6.2) |
| **2 · SaaS comercial** | Que otros gimnasios puedan entrar solos, con planes y prueba gratis | Un gimnasio se registra, prueba y pasa a pago sin intervención técnica |
| **3 · Escritorio** | Recepción sin internet, huella y torniquete | Definido después de que el primer cliente opere en la web |
| **4 · Expansión** | Varias sedes por dueño, app móvil del cliente | Cuando haya demanda real |

**Todo lo de las fases 1 y 2 es 100 % web.** La fase 3 empieza solo después de que el primer cliente opere en la web.

### Fase 1 · Lanzamiento con el primer cliente

No es una prueba: el cliente cobra membresías y controla el ingreso con GymOS. Por eso nada sale sin cumplir §6.1.

**1A · Operación diaria de recepción** — lo que el cliente usa desde el día 1:

| Flujo | Requisitos | Estado del backend (13-oct) |
|---|---|---|
| Crear y editar clientes, con consentimiento Ley 1581 | GW-RF-17, 19, 20 | Construido, con brechas menores (tipo de documento, acudiente) |
| Vender y renovar membresías, cobrar en caja | GW-RF-08 a 16, 24 a 27 | Construido, con brechas: turno por persona, regla C2 |
| Registrar ingreso (manual) | GW-RF-03, 04, 05 | Construido |
| **Registrar salida** | **GW-RF-54 (nuevo, §4.1)** | **No existe** |
| Ingresos de hoy y quién está adentro | GW-RF-06 (ampliado, §4.1) | Ingresos sí; "adentro" no |
| Toma de medidas | GW-RF-21 | Backend sí; falta la pantalla |
| Pantalla TV | GW-RF-07 | Construido; WebSocket roto en producción |
| Despliegue en VPS con HTTPS y respaldos | — | Pendiente (nginx de resttodash) |
| **Carga inicial** de clientes y membresías vigentes | **GW-RF-55 (nuevo, §4.6)** | **No existe** |

**1B · Resto de la v1** — los Must que faltan según `MATRIZ_TRAZABILIDAD.md` (clases, entrenamiento, inventario,
reportes, personal, configuración, auditoría y las brechas del SA). Se construye después del lanzamiento, sin tocar lo que el cliente ya usa.

Lo que no está en 1A se **oculta del menú** del cliente, no se muestra "en construcción".

### Fase 2 · SaaS comercial

- Planes de suscripción en el SA (§4.2).
- Registro autónomo con prueba gratis (§4.3).
- Sitio público de GymOS en `gymdeskcolombia.com`.
- Facturación electrónica **solo si un cliente la pide** (§4.4).

### Fase 3 · Escritorio (postergado)

Huella (GW-RF-01, 02, 22), torniquete, salida con huella y operación sin internet. El backend de huella ya existe y
queda congelado hasta esta fase.

### Fase 4 · Expansión (postergado)

Varias sedes por dueño (§4.5) y app móvil del cliente (GW-RF-18).

---

## 3. Reglas del SaaS

| Tema | Regla |
|---|---|
| Cobro a los gimnasios | **Manual.** MVC registra cada pago en el SA (SA-RF-16). No hay pasarela de pago |
| Aviso de vencimiento | Desde 5 días antes del corte, todos los roles ven el contador en el GW. Ya construido (GW-RF-51) |
| Gracia y bloqueo | Días 1–3 después del corte funciona con aviso; desde el día 4 queda bloqueado. Ya construido en el GW |
| Prueba | Bloqueo inmediato al vencer la prueba |
| Aislamiento | Cada sede es un gimnasio aislado: datos, clientes y staff no se comparten (hasta la fase 4) |
| Moneda y hora | COP enteros; fechas de negocio en America/Bogota |

---

## 4. Requisitos nuevos

### 4.1 GW-RF-54 Registrar salida — Must (fase 1A)

| Regla | Detalle |
|---|---|
| Quién la registra | Recepción, manualmente, desde Control de ingreso. En la fase 3 también la huella o el torniquete |
| Quién puede salir | Solo un cliente con un ingreso permitido (`abrio` o `alerta_mora`) **hoy** y sin salida registrada |
| Una salida por ingreso | Un ingreso tiene como máximo una salida. Registrar una segunda responde 409 |
| Quién está adentro | Se calcula: ingresos permitidos de hoy sin salida. Nunca se guarda |
| Cambio de día | Un ingreso sin salida al terminar el día queda como "sin salida registrada". Se calcula, sin procesos programados |
| Cortesías | No llevan salida (no tienen cliente asociado) |
| Pantalla TV | No muestra salidas |
| Reportes | Tiempo de permanencia por ingreso y promedio; los "sin salida registrada" se excluyen del promedio |
| Auditoría | Registrar y anular una salida quedan en la auditoría |

**CA**
- CA1: Un cliente que entró a las 6:00 y sale a las 7:30 queda con 90 minutos de permanencia.
- CA2: Intentar registrar la salida de alguien sin ingreso permitido hoy responde 409.
- CA3: Un ingreso de ayer sin salida no aparece en "quién está adentro" hoy.
- CA4: Con hora de Bogotá 23:50 de ingreso y 00:10 de salida, la salida se registra porque corresponde al ingreso abierto
  más reciente. *(Propuesta: confirmar si los gimnasios abren de noche.)*

**GW-RF-06** se amplía: la vista de ingresos del día muestra también la hora de salida y el conteo de quién está
adentro (antes estaba postergado a escritorio).

### 4.2 SA-RF-33 Planes de suscripción — Must (fase 2)

| Regla | Detalle |
|---|---|
| Catálogo | MVC crea planes en el SA: nombre, precio mensual y límites |
| Límites (propuesta) | Máximo de clientes activos y máximo de staff. Los módulos no se limitan por plan en la primera versión |
| Asignación | Cada gimnasio tiene un plan vigente. Cambiar de plan crea un registro nuevo en `superadmin.suscripciones` (no retroactivo, como SA-RF-14) |
| Pago | Manual. El aviso de monto (SA-RF-16 CA5) compara contra el precio del plan vigente |
| Exceder un límite | Bloquea crear clientes o staff nuevos con un mensaje para subir de plan; no bloquea la operación diaria |
| Plan de prueba | La prueba usa un plan sin costo con los mismos límites del plan más completo |

### 4.3 SA-RF-34 Registro autónomo con prueba gratis — Must (fase 2)

| Regla | Detalle |
|---|---|
| Dónde | Formulario en `gymdeskcolombia.com`: nombre del gimnasio, nombre y correo del Jefe, teléfono, ciudad |
| Verificación | El gimnasio se crea solo después de confirmar el correo con un enlace de un solo uso |
| Resultado | Provisioning igual que SA-RF-06, en estado `prueba`, con subdominio generado (SA-RF-05) |
| Duración | 5 días (decisión B). *(Propuesta: evaluar 14 días para registro autónomo.)* |
| Abuso | Una prueba por correo y por teléfono. MVC puede bloquear registros desde el SA |
| Paso a pago | MVC registra el pago manual en el SA: `prueba → activo` con ancla en la fecha del pago (P-08) |
| Aviso a MVC | Cada registro nuevo aparece en el Inicio del SA como "prueba nueva" |

### 4.4 Facturación electrónica — fuera de alcance (bajo demanda)

Ningún cliente la tiene hoy. Si un cliente la pide, se integra con un proveedor tecnológico autorizado por la DIAN
(candidato: Factus) como módulo opcional por gimnasio. Requisito de diseño desde ya: toda venta y pago guarda lo
necesario para facturar después (cliente, documento, ítems, precio, método de pago).

### 4.6 GW-RF-55 Carga inicial — Must (fase 1A)

| Regla | Detalle |
|---|---|
| Qué se carga | Clientes (documento, nombre, contacto, consentimiento) y su membresía vigente (plan y fecha de vencimiento) |
| Formato | Plantilla Excel/CSV que entrega MVC; el gimnasio la llena con sus datos actuales |
| Validación previa | Una simulación sin guardar muestra filas válidas y errores por fila (documento repetido, plan inexistente, fecha inválida) |
| Atómica | Se carga todo o nada |
| Pagos | Las membresías migradas se marcan como `origen = migracion`, sin pago en caja: no alteran el cuadre ni los reportes de ingresos |
| Quién | Solo el Jefe o MVC; queda en auditoría |

**CA**
- CA1: Un archivo con un documento repetido no carga nada y reporta la fila.
- CA2: Un cliente migrado con vencimiento en 10 días aparece `activo`, y con vencimiento ayer y g = 3 aparece `en_gracia`.
- CA3: Los ingresos del día no cuentan las membresías migradas.

### 4.5 Varias sedes — fase 4 (propuesta de diseño)

- Se agrega una **cuenta de dueño** por encima de N gimnasios. Cada sede sigue siendo un gimnasio aislado, con su
  propio subdominio, plan y cobro.
- El Jefe de la cuenta ve un selector de sede y reportes consolidados.
- Clientes **no compartidos** en la primera versión. Compartir membresías entre sedes es una decisión aparte.

---

## 5. Decisiones abiertas

| # | Tema | Valor por defecto si no se decide |
|---|---|---|
| D-1 | ¿Los gimnasios abren de noche (salida después de medianoche)? | No: la salida solo cierra ingresos del mismo día |
| D-2 | Límites concretos de cada plan (clientes, staff) y precios | Se definen antes de la fase 2 |
| D-3 | Duración de la prueba en registro autónomo | 5 días |
| D-4 | Subdominio del cliente | Pendiente |
| D-5 | ¿Dónde lleva hoy el gimnasio sus clientes y vencimientos (Excel, cuaderno, otro software)? | Se asume Excel |

---

## 6. Salida a producción

### 6.1 Condiciones de salida (todas obligatorias)

| # | Condición | Cómo se verifica |
|---|---|---|
| 1 | Tareas B1–B6, M1, F1–F4 e I1 de `PROMPTS-AGENTES.md` unidas a `main` | Revisión de código aprobada por Juan |
| 2 | Suite de pruebas del backend en verde | Salida de pytest adjunta |
| 3 | Pruebas de aceptación del flujo diario (tarea Q1) en verde sobre el servidor de producción | `REPORTE-ACEPTACION.md` |
| 4 | Respaldo diario funcionando y **una restauración probada** | Restauración en una BD aparte con conteos iguales |
| 5 | HTTPS en el subdominio del cliente y Pantalla TV conectada por `wss://` | Prueba en el equipo de recepción del gimnasio |
| 6 | Gimnasio configurado: planes y precios, métodos de pago, días de gracia y "por vencer", staff con sus roles | Lista revisada con el Jefe |
| 7 | Carga inicial hecha y revisada por el Jefe con una muestra de 20 clientes | Muestra aprobada por el Jefe |
| 8 | Capacitación de recepción y del Jefe | Cada recepcionista hace sola un ingreso, una venta y un cierre de caja |
| 9 | Canal de soporte y tiempo de respuesta acordados | Acuerdo con el cliente |

### 6.2 Migración en máximo 4 días

| Día | El gimnasio hace | MVC hace |
|---|---|---|
| **0 (antes)** | Entrega la plantilla de carga llena | Carga inicial, configuración y capacitación |
| **1** | Ingreso y caja en GymOS; el método anterior queda de respaldo en paralelo | Acompaña la apertura; revisa errores al cierre |
| **2** | Clientes nuevos, renovaciones y cobros **solo** en GymOS; corrige datos migrados cuando el cliente llega | Corrige lo reportado el mismo día |
| **3** | Deja el método anterior; medidas en GymOS | Revisa con el Jefe el cuadre de caja de los 3 días |
| **4** | Corte definitivo: el método anterior queda solo de consulta | Reunión de cierre y lista de ajustes para la fase 1B |

**Regla de reversa:** si un día falla el ingreso o la caja y no se resuelve en 1 hora, ese día se opera con el método
anterior y después se registra en GymOS. La migración se corre un día; no se reinicia.
