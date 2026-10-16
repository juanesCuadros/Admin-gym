# GymOS Desktop — Especificación Técnica y Funcional de la Aplicación de Escritorio (Offline-First)

> **Documento de Arquitectura y Requisitos**  
> **Para:** Equipo de Desarrollo / Producto GymOS  
> **Propósito:** Diseñar la estación de trabajo de escritorio para recepción con tolerancia total a fallos de internet, hardware local y distribución multi-tenant universal sin código custom por cliente.

---

## 1. Visión General y Objetivos Críticos

En la operación real de un gimnasio, **la pérdida de conexión a internet no puede paralizar el negocio**. Si la red falla:
1. Los deportistas **deben poder seguir ingresando** (validación de huella o documento y apertura de torniquete sin latencia).
2. La recepción **debe seguir vendiendo** bebidas, suplementos y cobrando o renovando membresías en caja.
3. El turno de caja **debe seguir registrando dinero** y emitiendo tickets en la impresora térmica.

### Principios Rectores:
- **Offline-First:** La aplicación opera contra una base de datos local embebida de alta velocidad. Trabaja igual con o sin conexión a internet.
- **Sincronización Bidireccional Automática:** Tan pronto regresa la conexión, las transacciones locales pendientes se envían a la nube de forma ordenada e idempotente, y los cambios de la nube se descargan a la máquina local.
- **Rol 100% Recepcionista:** Contempla todas las funciones y restricciones del rol `recepcionista` definidas en la matriz de permisos RBAC del gimnasio.
- **Cero Código a Medida (Multi-Tenant Universal):** Un único instalador (`GymOS-Desktop-Setup.exe`) sirve para miles de gimnasios distintos. Cada gimnasio se activa mediante su subdominio o un código de emparejamiento único que descarga su configuración, logo y datos locales automáticamente.

---

## 2. Alcance Funcional: Módulos del Rol Recepcionista

La aplicación de escritorio cubre el 100% de la operación diaria de la recepción:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   GymOS Desktop (Estación Recepción)                   │
├───────────────────┬───────────────────┬────────────────────────────────┤
│ 1. Control Acceso │ 2. Caja & POS     │ 3. Deportistas & Membresías    │
│  • Huella USB     │  • Turnos caja    │  • Búsqueda ultrarrápida       │
│  • Torniquete COM │  • Cobro planes   │  • Enrolamiento biométrico     │
│  • Check-in doc   │  • Venta tienda   │  • Foto webcam                 │
│  • Cortesías      │  • Ticket térmico │  • Reservas & Clases           │
└───────────────────┴───────────────────┴────────────────────────────────┘
```

### 2.1. Control de Ingreso y Biometría Local
- **Check-in por Huella Dactilar:** Captura mediante lector biométrico USB, comparación 1:N local contra los templates almacenados en la base de datos local en menos de 200 ms.
- **Check-in Manual:** Búsqueda instantánea por número de documento o código de barras/QR de carnet.
- **Apertura de Torniquete / Puerta:** Envío de pulso eléctrico mediante puerto Serial/USB o relé de red al validar acceso exitoso.
- **Evaluación de Reglas de Acceso en Local:**
  - Deportista activo $\to$ Acceso permitido (luz verde / pulso a torniquete).
  - En período de gracia de mora $\to$ Acceso permitido con aviso en pantalla de cobro pendiente.
  - Vencido o congelado $\to$ Acceso denegado con motivo visible en pantalla y sonido de alerta.
  - Antirretorno / Deduplicación (3 segundos): Evita que un doble apoyo accidental registre dos entradas.
- **Pase de Cortesía:** Registro de acceso eventual con motivo obligatorio (auditable).

### 2.2. Caja y Turnos (Punto de Venta / POS)
- **Apertura y Cierre de Turno:** Registro de base de caja inicial, arqueo de efectivo y vouchers al cierre.
- **Venta de Mostrador:** Venta rápida de productos (aguas, batidos, toallas) con descuento inmediato de inventario local.
- **Cobro de Membresías y Renovaciones:** Venta de planes, cálculo de nueva fecha de vigencia y registro de métodos de pago (Efectivo, Tarjeta, Transferencia).
- **Impresión de Recibos Térmicos:** Salida directa a impresoras ESC/POS (58mm / 80mm) y apertura automática de cajón monedero (RJ11).
- **Control de Egresos:** Registro de salidas menores de caja chica con descripción obligatoria.

### 2.3. Gestión de Deportistas y Membresías
- **Enrolamiento de Huellas:** Registro y cifrado de 1 o 2 huellas del deportista utilizando el sensor USB de escritorio.
- **Captura de Foto de Perfil:** Toma directa desde la cámara web de la recepción con recorte cuadrado automático.
- **Alta Rápida de Clientes:** Formulario optimizado para registrar nombre, documento, WhatsApp, fecha de nacimiento y contacto de emergencia.
- **Asistencia a Clases Grupales:** Marcación de presencia en la clase reservada.

---

## 3. Arquitectura Offline-First y Motor de Sincronización

La aplicación implementa el patrón **Local-First con Outbox Transaccional**. La interfaz de usuario nunca espera una respuesta HTTP de internet para confirmar una venta o un check-in.

```
┌──────────────────────────────────────────────────────────────────────┐
│                            ARQUITECTURA LOCAL                        │
│                                                                      │
│   [ Interfaz Recepcionista (React 19 + TypeScript) ]                 │
│                          │                                           │
│                          ▼                                           │
│   [ Capa de Negocio Local (Validación de Reglas & Hardware) ]        │
│          │                                         │                 │
│          ▼                                         ▼                 │
│   [ SQLite Cifrado Local ]                [ Outbox Queue (Buffer) ]  │
│   (Deportistas, Huellas,                   (Ventas, Check-ins,       │
│    Planes, Productos, Turno)                Pagos pendientes de subir)│
│                                                    │                 │
└────────────────────────────────────────────────────┼─────────────────┘
                                                     │ (Cuando hay red)
                                                     ▼
                                       ┌───────────────────────────────┐
                                       │   GymOS Cloud API (FastAPI)   │
                                       │   PostgreSQL + Multi-Tenant   │
                                       └───────────────────────────────┘
```

### 3.1. Base de Datos Embebida (SQLite con SQLCipher)
En la máquina de recepción se almacena una base de datos SQLite cifrada con clave AES-256 derivada del token de la máquina.
- **Tablas replicadas en local (Lectura / Actualización):**
  - `deportistas` (datos básicos, documento, estado).
  - `deportista_huellas` (templates biométricos cifrados).
  - `membresias` (vigencias, planes, fecha de corte).
  - `planes` (tarifas, nombres, duración).
  - `productos_inventario` (artículos de mostrador, precios, stock).
  - `permisos_rol` (matriz RBAC vigente configurada por el Jefe).
- **Tablas operativas locales (Escritura):**
  - `turnos_caja_local` (turno activo de la terminal).
  - `ventas_local` y `pagos_local`.
  - `checkins_local` (histórico de accesos del día).
  - `sync_outbox` (cola transaccional de sincronización).

### 3.2. Mecanismo de Sincronización (Sync Engine)

#### A. Replicación Local $\to$ Nube (Push via Outbox Pattern)
1. Toda acción de escritura offline genera un registro local en `sync_outbox` con:
   - `id`: UUID v4 generado por el cliente.
   - `idempotency_key`: Clave única para evitar duplicidades en el servidor si la conexión se interrumpe a mitad de subida.
   - `endpoint`: Ruta de destino (ej. `/api/v1/control-ingreso/checkin-huella`).
   - `payload`: JSON con los datos de la transacción.
   - `created_at`: Fecha y hora UTC local del evento.
   - `intentos` y `estado`: (`pendiente`, `en_progreso`, `completado`, `error`).
2. Un proceso en segundo plano (Worker) detecta conectividad (mediante ping o WebSocket heartbeat).
3. Envía los eventos en orden cronológico estricto en paquetes de ráfaga (batches).
4. El backend de FastAPI procesa e inserta en PostgreSQL dentro del `gimnasio_id` correspondiente con sus validaciones de RLS.

#### B. Replicación Nube $\to$ Local (Pull Incremental)
1. Para mantener actualizados los clientes que se registran online o los planes modificados por el Jefe, la app de escritorio ejecuta una consulta diferencial periódica cada 30 segundos (o recibe avisos en tiempo real mediante WebSocket si hay internet).
2. Se utiliza la técnica de **High-Water Mark** (`updated_at > :ultimo_sync`): solo se descargan los registros creados o modificados desde la última sincronización exitosa.

#### C. Resolución de Conflictos
- **Check-ins:** Aditivos (no hay colisión; cada check-in es un evento único).
- **Ventas y Pagos:** Aditivos con UUIDs independientes.
- **Stock de Inventario:** Delta relativo (ej. `stock = stock - 1`) en lugar de sobreescritura absoluta.
- **Membresías / Datos de Deportistas:** El servidor central resuelve con *Last-Write-Wins* considerando la marca de tiempo de auditoría.

---

## 4. Integración de Hardware Local (Periféricos)

A diferencia de un navegador web estándar que tiene acceso limitado al hardware, la app de escritorio se comunica nativamente con:

| Periférico | Protocolo / Interfaz | Función |
| :--- | :--- | :--- |
| **Lector Biométrico** | USB SDK nativo (C++ / DLL) | Captura de imagen, extracción de minucias y matching 1:N local (ej. DigitalPersona U.are.U, ZKTeco). |
| **Torniquete / Puerta** | Serial RS232 / USB CDC / Relé IP | Disparo de pulso de apertura (500ms) al autorizar acceso. |
| **Impresora Térmica** | ESC/POS (USB / Red 9100) | Impresión rápida de recibos de membresía y tirillas de venta sin cuadro de diálogo del SO. |
| **Cajón Monedero** | RJ11 conectado a impresora | Apertura automática mediante comando ESC/POS (`ESC p 0 25 250`). |
| **Cámara Web** | MediaDevices / UVC nativo | Fotografía de bienvenida y perfil del deportista al registrarlo. |
| **Pantalla TV / Segundo Monitor** | Multi-Window Display | Si la PC de recepción tiene 2 monitores conectados (uno apuntando a los clientes), la app proyecta la pantalla de saludo y bienvenida sin depender de red. |

---

## 5. Estrategia Multi-Tenant Universal ("Cero Código a Medida")

Para evitar compilar un instalador diferente para cada cliente que compre el software:

### 5.1. Instalador Único
Se genera un único instalador estándar: `GymOS-Desktop-Setup.exe` (Windows) y DMG/AppImage si se requiere Mac/Linux.

### 5.2. Flujo de Emparejamiento y Activación (Pairing Flow)
```
[ Instalar GymOS Desktop ]
          │
          ▼
[ Pantalla de Bienvenida ] ──► Ingresa: Subdominio del Gimnasio (ej. "powergym")
          │                             + Credenciales o "Código de Estación"
          ▼
[ Validación con Cloud API ]
          │
          ├── 1. Descarga gimnasio_id y Tenant Token
          ├── 2. Descarga Branding (Nombre, Logo, Tema)
          ├── 3. Descarga Matriz de Permisos RBAC del gimnasio
          └── 4. Realiza el Seed Inicial en SQLite (deportistas, planes, huellas)
          │
          ▼
[ ¡Estación Lista para Operar 100% Offline! ]
```

1. Al abrir la app por primera vez, el recepcionista o el dueño ve una pantalla limpia pidiendo el **Subdominio del Gimnasio** (o escanea un QR generado en el panel web del Jefe).
2. La app valida contra el backend central, confirma que el gimnasio esté `activo`, obtiene su `gimnasio_id` y recibe una clave de dispositivo (`device_token`).
3. Descarga el paquete de configuración: nombre del gimnasio, logo, reglas de mora, métodos de pago y catálogo de planes.
4. Realiza la descarga inicial de deportistas y huellas para poblar la base de datos local SQLite.
5. A partir de ese momento, la app queda vinculada a ese gimnasio. Si cambian los colores o el logo en la nube, se actualiza automáticamente.

### 5.3. Actualizaciones Silenciosas (Auto-Updater)
- Las actualizaciones se publican en un servidor de releases (GitHub Releases / Cloudflare R2 / S3).
- La app verifica nuevas versiones en segundo plano y se actualiza sola sin intervención técnica.

---

## 6. Stack Tecnológico Recomendado

Comparamos las dos opciones líderes para este tipo de software:

| Criterio | Opción A: Tauri 2.0 (Recomendada) | Opción B: Electron |
| :--- | :--- | :--- |
| **Núcleo / Backend Local** | **Rust** (ultra eficiente, seguro y rápido) | **Node.js** (JavaScript) |
| **Frontend / UI** | **React 19 + TypeScript + Vite** (el mismo del proyecto web) | **React 19 + TypeScript + Vite** |
| **Base de Datos Local** | **SQLite nativo (vía rusqlite / SQLx)** | **better-sqlite3** |
| **Consumo de Memoria RAM** | **~40 MB a 70 MB** (muy ligero) | **~250 MB a 500 MB** |
| **Tamaño del Instalador** | **~15 MB** | **~130 MB - 180 MB** |
| **Acceso a Hardware (USB/Serial)**| Crates nativos de Rust (`serialport`, SDKs C/C++) | Módulos npm (`serialport`, `usb`) |
| **Rendimiento Biometría 1:N** | Crítico / Máximo (C++ / Rust) | Rápido (vía node-addon) |

### Dictamen Tecnológico:
- **Tauri 2.0 con React 19 + TypeScript + SQLite:**
  Es la mejor opción a largo plazo. Las computadoras de recepción de muchos gimnasios suelen ser equipos estándar o de recursos limitados. Tauri consume hasta un 80% menos memoria que Electron, no sufre lentitud y ofrece acceso nativo de bajísima latencia a puertos seriales y lectores de huella.
- **Reutilización de Código:**
  Dado que el frontend se construye en **React 19 + Vite + TypeScript**, se puede reutilizar directamente el sistema de diseño, componentes (`Card`, `Button`, `Badge`, `Toast`), tokens de CSS y lógica de vistas que ya existen en [`gym-jefe-web`](file:///c:/Users/Nitro%205/Documents/Juan/ProyectosMVC/FitApp/Admin-gym/producto/gym-jefe-web).

---

## 7. Seguridad y Protección de Datos

1. **Cumplimiento Ley 1581 / RNF-01 (Biometría Cifrada):**
   - Las minucias/templates de huellas dactilares **nunca se guardan en texto plano**.
   - Se almacenan cifradas en SQLite con AES-256-GCM.
2. **Cifrado de Base de Datos en Disco:**
   - La base de datos local SQLite se protege con SQLCipher. Si alguien extrae físicamente el disco duro de la máquina de recepción, no puede abrir el archivo `.db`.
3. **Control de Sesiones de Staff:**
   - Inicio de sesión con PIN rápido o contraseña de recepcionista.
   - Bloqueo automático de terminal tras 5 minutos de inactividad.
4. **Auditoría Append-Only Local:**
   - Todas las ventas, aperturas de caja, cortesías y check-ins se guardan con firma SHA-256 local antes de ser replicadas a la nube.

---

## 8. Hoja de Ruta de Implementación Propuesta

1. **Fase 1: Andamiaje y SQLite Local**
   - Configuración del proyecto Tauri + React.
   - Creación del esquema SQLite local replicando entidades mínimas (`deportistas`, `membresias`, `checkins`, `caja`).
   - Flujo de activación por subdominio y sincronización inicial de catálogo.
2. **Fase 2: Motor de Check-in y Hardware de Ingreso**
   - Lógica de evaluación de acceso local (activo, mora, vencido, gracia).
   - Driver de comunicación por puerto serial (COM/USB) para torniquete.
   - Integración del lector de huella dactilar USB.
3. **Fase 3: Módulo de Caja POS y Ticketing**
   - Apertura/cierre de turnos de recepción.
   - Venta y cobro con almacenamiento en `sync_outbox`.
   - Conexión e impresión directa en impresora térmica ESC/POS.
4. **Fase 4: Sincronizador Bidireccional Robusto**
   - Worker en segundo plano de sincronización y reintentos exponenciales.
   - Pruebas de desconexión forzada de internet durante 24 horas y re-sincronización exitosa sin duplicados ni pérdidas.
5. **Fase 5: Empaquetado y Auto-Updater**
   - Configuración de pipelines de compilación de instaladores `.exe`.
   - Validación del sistema de actualizaciones automáticas.
