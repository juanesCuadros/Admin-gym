# Inventario de vistas — Admin-GYM (Sistema Web del Gimnasio)

Fase 1 · 16-sep-2026 · solo código. Frontend: `producto/gym-jefe-web/src` (React 19 + react-router 7 + axios). Backend de referencia: `producto/gym-jefe-api/app`.
Rutas relativas a `producto/gym-jefe-web/src/` salvo que empiecen por `api/` (backend, relativo a `producto/gym-jefe-api/app/modules/`).

**Fuentes de verdad usadas:** `App.tsx:32-57` (rutas), `components/layout/ProtectedRoute.tsx` (guard), `components/layout/Sidebar.tsx:32-140` (menú), `api/*.service.ts` (endpoints), `contexts/AuthContext.tsx` (sesión y permisos).

**Leyenda de Datos:** `API` = llama al backend y el endpoint existe · `API⚠` = llama al backend pero el endpoint **no coincide** con el router · `MOCK` = datos hardcodeados o estado local sin persistir · `DEMO` = flujo simulado en cliente.

---

## A. Vistas por módulo

### 00 · Reglas transversales

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Layout de app | (envuelve `/` y todas las protegidas) | `components/layout/AppLayout.tsx:122` | layout | `ProtectedRoute` sin `requiredSubmodule` (`App.tsx:39`) | Sidebar + Header + `<Outlet>` | abrir/cerrar sidebar | — | cargando sesión (`ProtectedRoute.tsx:92-98`) |
| Header | — | `components/layout/Header.tsx` | componente | todos | nombre del tenant, badge "Caja: Turno Abierto/Cerrada", avatar + nombre + rol, toggle tema | **selector de tenant** (`TENANT_PRESETS`, `:95-150`), logout (`:199`) | `GET /caja/turnos/actual` (`Header.tsx:23`) | error → caja cerrada (`:25-26`) |
| Sidebar | — | `components/layout/Sidebar.tsx` | componente | por `hasPermission(submodulo,'leer')` | 12 ítems (ver §C) | navegación | — | — |
| Dashboard | `/` | `pages/dashboard/DashboardPage.tsx` | página | autenticado | 4 KPI (deportistas, ingresos hoy, estado caja, clases hoy), acciones rápidas, próximas clases | navegar a módulos | `GET /control-ingreso/ingresos-hoy`, `/caja/turnos/actual`, `/clases`, `/deportistas` (`:43-46`) | cargando `'...'`; **fallback a números fijos 142/38/6 si el real es 0 o falla** (`:118,124,148`) |
| Catch-all | `*` | `App.tsx:56` | redirect | — | — | → `/` | — | — |

### 01 · Autenticación

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Login | `/login` | `pages/auth/LoginPage.tsx` | página | pública | correo, contraseña, subdominio derivado del tenant (`:23,94`), **`<select>` de sede** con 4 presets (`:116-140`) | Iniciar sesión (`:164`); **"Acceso Rápido Demo" jefe/recepcionista/entrenador** (`:175-214` → `AuthContext.tsx:84-114`, token `mock_jwt_token_demo_gymos`) | `POST /auth/login` (`api/auth.service.ts:17`) | cargando; error por toast |
| Recuperar contraseña | — | — | **no existe** | — | — | — | `solicitarRecuperacion`/`confirmarRecuperacion` definidos en `api/auth.service.ts:37,42` **sin pantalla ni enlace** | — |
| Sesión expirada | — | `contexts/AuthContext.tsx:47-51` | evento global | — | toast "Sesión expirada" | limpia sesión; `ProtectedRoute` redirige a `/login` **sin conservar la ruta** (`ProtectedRoute.tsx:101`) | evento `gymos_session_expired` desde `api/client.ts:80,103` | — |

### 02 · MyGymOS (configuración)

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Configuración y Branding | `/configuracion` | `pages/configuracion/ConfiguracionPage.tsx` | página | menú: `configuracion:leer`; ruta: solo autenticado | nombre, 3 colores, presets; días de gracia, umbral por vencer, tope congelamiento; subdominio y zona horaria (solo lectura `:212-213`) | "Guardar Cambios" → `updateBranding` **solo en contexto + localStorage** (`:23-32` → `TenantThemeContext.tsx:241-255`, `:45`); los 3 parámetros **no se envían a ningún lado** (`:19-21`, ningún `apiClient`) | **MOCK**. `api/myGym.service.ts` solo llama `GET /my-gym/status` (`:5`). Backend tiene `PUT /my-gym/info`, `PATCH /parametros`, `PUT /metodos-pago`, `GET /landing`, `/landing/qr.png`, `/auditoria` (`api/my_gym/router.py:67-278`) sin consumir | ninguno (0 `loading`) |

### 03 · Personal y permisos

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Matriz de permisos | `/personal` | `pages/personal/PersonalPage.tsx` | página | menú: `personal:leer`; subtítulo "Solo Jefe" (`:96`) no forzado en UI | tabla rol × submódulo con checkboxes leer/crear/editar/eliminar | toggle + "Guardar" | `GET/PUT /auth/permisos/matriz` (`api/auth.service.ts:47,52` ↔ `api/auth/router.py:139,155`) | cargando, guardando; error por toast |
| Staff (listar, crear, editar, activar/desactivar, transferir jefe) | — | — | **no existe** | — | — | — | Backend `api/personal/router.py:31-156` completo, **ningún servicio en `api/`** | — |

### 04 · Planes

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Tab "Planes" | `/membresias` (tab) | `pages/membresias/MembresiasPage.tsx:258,380-420` | tab | menú: `membresias:leer` | cards: nombre, tipo, precio, duración, cupo personas | "Crear Plan" (modal `:425-485`: nombre, precio, duración días, modalidad, cupo) | `GET/POST /membresias/planes` (`api/membresias.service.ts:19,24`) → **API⚠**: el router no tiene prefijo y expone `/planes` (`api/membresias/router.py:29,37`); `GET /membresias/planes` cae en `GET /membresias/{id}` con `id="planes"` | cargando |
| Editar / desactivar plan | — | — | no existe en UI | — | — | — | `editarPlan`, `cambiarEstadoPlan` en `api/membresias.service.ts:29,34` sin uso | — |

### 05 · Inventario

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Inventario | `/inventario` | `pages/inventario/InventarioPage.tsx` | página | menú: `inventario:leer` | tabla: producto, categoría, precio, stock, stock mínimo, estado | "Registrar Producto" (modal `:120`) → `setProductos` local (`:49`) | **MOCK**: 6 productos en `useState` (`:24-31`); no importa ningún servicio. Backend `api/inventario/router.py:42-216` (10 endpoints) sin consumir | ninguno |

### 06 · Deportistas

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Listado | `/deportistas` | `pages/deportistas/DeportistasPage.tsx:263-378` | página | menú: `deportistas:leer` | tabla: documento, nombre, teléfono, plan, **estado membresía (badge)**, vencimiento; búsqueda; filtro por estado (`:291-302`) | Inscribir, Editar, Ficha | `GET /deportistas` con `skip/limit/q/estado_membresia` (`:100-103` ↔ `api/deportistas/router.py:63`) | cargando, vacío (Table), paginación |
| Inscribir | modal | `:381-485` | modal | — | documento, nombre, correo, teléfono, sexo, fecha nacimiento, estatura, acudiente, **checkbox consentimiento 1581** (bloquea si no está: `:121`) | crear | `POST /deportistas` (`:128`) | procesando; error toast |
| Ficha 360° | modal | `:487-608` | modal | — | datos, membresía actual (plan, vence, días, congelada), mediciones recientes. **No pinta** `ultimos_pagos`, `ultimos_accesos`, `huellas_enroladas`, `cuenta_app` que sí devuelve el backend (`api/deportistas/schemas.py:206-213`) | Editar datos, **Enrolar Huella** (`:525` → `POST /deportistas/{id}/huellas`), Registrar medición | `GET /deportistas/{id}/ficha` (`:203`) | "Cargando ficha..." |
| Registrar medición | modal | `:610-666` | modal | — | peso, % grasa, músculo | guardar | `POST /deportistas/{id}/mediciones` (`:216`) | procesando |
| Editar datos | modal | `:668-765` | modal | — | mismos campos que inscribir | guardar | `PUT /deportistas/{id}` (`:170`) | procesando |
| Desactivar / suprimir datos (Ley 1581) | — | — | no existe en UI | — | — | — | `cambiarEstado`, `suprimirDatos` en `api/deportistas.service.ts:50,55` sin uso; backend `PATCH /{id}/estado`, `POST /{id}/suprimir-datos` (`router.py:172,319`) | — |

### 07 · Membresías

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Tab "Membresías" | `/membresias` | `pages/membresias/MembresiasPage.tsx:258-378` | tab | menú: `membresias:leer` | tabla: deportista, plan, vigencia, días restantes, estado (`congelamiento_activo` → Congelada / `cancelada` → Cancelada / `estado_calculado`, `:307-308`) | Descongelar, Congelar, Cambiar Plan, Cancelar; "Asignar Plan" | `GET /membresias` (`:86` ↔ `router.py:166`) | cargando, paginación |
| Asignar plan | modal | `:488-523` | modal | — | deportista (select, carga `GET /deportistas`), plan | asignar | `POST /membresias/asignar` (`:137` ↔ `router.py:145`) | procesando |
| Congelar | modal | `:525-550` | modal | — | motivo opcional; texto explica recálculo | congelar | `POST /membresias/{id}/congelar` (`:155`); **sin fecha_inicio/fin ni días** (solo `motivo`, `api/membresias/schemas.py:86-87`) | procesando |
| Cambiar plan | modal | `:552-580` | modal | — | nuevo plan | cambiar | `POST /membresias/{id}/cambiar-plan` (`:185`) | procesando |
| Cancelar | modal | `:582-606` | modal | — | motivo obligatorio | cancelar | `POST /membresias/{id}/cancelar` (`:201`) | procesando |
| Botón Congelar visible en vencidas | — | `:317-330` | — | — | se muestra siempre que no esté congelada; el rechazo (`MEMBRESIA_VENCIDA`) lo da el backend (`api/membresias/service.py:622-626`) | — | — | — |

### 08 · Caja

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Caja y turnos | `/caja` | `pages/caja/CajaPage.tsx` | página | menú: `caja:leer` | KPI: base, ventas efectivo (+pagos membresía), egresos, total esperado; tabla movimientos (hora, tipo, concepto, método, monto) | Abrir turno, Cerrar turno, Registrar venta, Registrar egreso | `GET /caja/turnos/actual` (`:63`), `GET /caja/turnos/{id}/movimientos` (`:67`) | cargando; "No hay turno de caja abierto" (`:267`) |
| Abrir turno | modal | `:346-372` | modal | — | base inicial (default `'50000'`, `:40`) | abrir | `POST /caja/turnos/abrir` (`:87`) | procesando |
| Arqueo y cierre | modal | `:375-436` | modal | — | esperado, efectivo contado, diferencia calculada en vivo (`:424-431`) | cerrar | `POST /caja/turnos/cerrar` (`:103`) | procesando |
| Venta en mostrador | modal | `:438-595` | modal | — | ítems (tipo pase_dia/pase_clase/producto, descripción, cantidad, **precio unitario editable** `:518`), método, tipo medio, valor recibido, cambio | cobrar | `POST /caja/ventas` con `X-Idempotency-Key` (`:130-145`, clave conservada entre reintentos) | procesando |
| Ítem "producto" en la venta | — | `:470-488,541` | — | — | descripción libre y precio fijo 6000; **no envía `producto_id`** | — | backend lo exige si `tipo=='producto'` (`api/caja/schemas.py:50`) → la venta de producto desde la UI no puede pasar | — |
| Egreso o vale | modal | `:597-628` | modal | — | monto, motivo obligatorio | registrar | `POST /caja/egresos` (`:163`) | procesando |
| Pago de membresía, anular venta, anular pago, cierre forzado | — | — | **no existen en UI** | — | — | — | métodos en `api/caja.service.ts:33,52,60,69` sin uso; backend `router.py:103,191,224,259` | — |

### 09 · Control de ingreso + Pantalla TV

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Control de Ingreso y Torniquete | `/control-ingreso` | `pages/controlIngreso/ControlIngresoPage.tsx` | página | menú: `control_ingreso:leer` | input documento; card "Estado del Torniquete" con último resultado (`abrio`/`alerta_mora`/`negado`, `:217-242`) y `estado_calculado` (`:269`); historial de hoy (hora, deportista, método huella/manual, resultado, motivo) | Check-in manual (`:66`), **"Simular Huella"** (`:143` → `POST /control-ingreso/checkin-huella` con UUID fijo `:91-93`), Cortesía (modal `:361-388`, motivo obligatorio) | `POST /control-ingreso/checkin-manual`, `/cortesia`, `GET /ingresos-hoy` (`api/controlIngreso.service.ts:12-27` ↔ `router.py:24-99`) | procesando, cargando historial; error toast |
| Pantalla TV | `/pantalla-tv`, `/tv/:subdominio` | `pages/pantallaTv/PantallaTvPage.tsx` | página **pública** (`App.tsx:35-36`, fuera de `ProtectedRoute`) | ninguna sesión; exige **device token** (modal `:673`, guardado en `localStorage` `:180-181`) | hora, logo, avisos rotativos, clases del día, saludo "Bienvenido" por WS (`:113-130`), estado de reconexión | fullscreen (`:206`), probar saludo (`:191` → `POST /pantalla-tv/test-saludo`), cambiar subdominio (`:267`) | `GET /pantalla-tv/display/{sub}` (`:83`), WS `/pantalla-tv/ws/{sub}?device_token=` (`api/pantallaTv.service.ts:86` ↔ `router.py:28-32`), reconexión exponencial hasta 30 s (`:133`) | sin token → modal; sin clases (`:589`) |
| Ítem de menú "Pantalla Recepción (TV)" | — | `Sidebar.tsx:76-80` | — | `show: true` para todos | — | abre `/pantalla-tv` en la misma pestaña (sale del layout autenticado) | — | — |
| Config de pantalla (avisos, logo, regenerar token) | — | — | no existe en UI | — | — | — | `getConfig/updateConfig/regenerarToken` en `api/pantallaTv.service.ts:195-205` sin uso | — |

### 10 · Entrenamiento

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Tab "Ejercicios" | `/entrenamiento` | `pages/entrenamiento/EntrenamientoPage.tsx:221-338` | tab | menú: `entrenamiento:leer` | cards: nombre_es, badge Personalizado/Global (`:261-262`), grupo muscular, equipo | "Nuevo Ejercicio" (modal `:340-394`: nombre_es, grupo, equipo, instrucciones) | `GET/POST /entrenamiento/ejercicios` (`:73,108` ↔ `router.py:37,83`) | cargando |
| Tab "Plantillas" | tab | `:221+` | tab | — | lista de plantillas; modal detalle (`:396-447`) con ítems (series, reps, descanso) | "Nueva Plantilla": setea estado (`:184-200`) pero **no hay `<Modal>` para `showCrearPlantillaModal`** (`:57` es la única referencia) ni llamada a `crearPlantilla` | `GET /entrenamiento/plantillas`, `/plantillas/{id}` (`:90,128`) | cargando |
| Asignar rutina | modal | `:449-478` | modal | — | deportista, plantilla; texto "copia inmutable (snapshot)" | asignar | `POST /entrenamiento/rutinas-asignadas` (`api/entrenamiento.service.ts:55`) → **API⚠**: backend expone `POST /entrenamiento/asignar-rutina` (`router.py:363-364`) | procesando |
| Rutinas del deportista, personalizar, activar/desactivar ejercicio | — | — | no existen en UI | — | — | — | `getRutinasDeportista` apunta a `/rutinas-asignadas/deportista/{id}` (`service.ts:60`) — backend es `/deportistas/{id}/rutinas` (`router.py:396`); `personalizarRutina` usa POST (`:70`), backend PUT (`router.py:478`) | — |

### 11 · Clases

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Clases y Reservas | `/clases` | `pages/clases/ClasesPage.tsx` | página | menú: `clases:leer` | tabla: fecha/hora, clase, profesor (`entrenador_nombre` o `profesor_externo`), aforo `reservas/cupo` + disponibles, estado, acciones | Programar, Ver reservas, Cancelar clase | `GET /clases` (`:63` ↔ `router.py:67`) | cargando, paginación |
| Programar clase | modal | `:285-374` | modal | — | nombre, disciplina, **profesor solo como texto** (`:324-327`, no selecciona entrenador del sistema), fecha/hora, cupo, duración, checkbox omitir festivos. **Sin campos de recurrencia** (`formData` `:38-46` no tiene `recurrente`/`regla_recurrencia`) | programar | `POST /clases` (`:81`) | procesando |
| Reservas de la clase | modal | `:376-481` | modal | — | lista de reservas, aforo | Inscribir (deshabilitado si `cupos_disponibles===0`, `:386`), Marcar asistencia (`:138`) | `GET /clases/{id}/reservas` (`:96`), `POST /clases/{id}/asistencia` | cargando |
| Inscribir deportista | modal | `:483-513` | modal | — | deportista (select); texto: valida pase de clase en Caja | reservar | `POST /clases/{id}/reservas` (`:120`) | procesando |
| Cancelar clase | acción | `:149-158` | — | — | sin confirmación previa | cancelar | `POST /clases/{id}/cancelar` (`api/clases.service.ts:35`) → **API⚠**: backend es `PATCH` (`router.py:170-171`) | — |
| Editar clase, cancelar reserva, cerrar, calificar | — | — | no existen en UI | — | — | — | backend `router.py:137,271,371,406,439`; `cancelarReserva`/`getAsistencia` en servicio sin uso | — |

### 12 · Reportes

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Reportes y Métricas | `/reportes` | `pages/reportes/ReportesPage.tsx` | página | menú: `reportes:leer` | 4 KPI fijos ("$14,850,000", "84.2%", "6:00 - 8:30 PM", "91.5%", `:20-42`), distribución por concepto (`:53-55`), estado del padrón | ninguna (no hay exportar ni filtros) | **MOCK** total: sin `useState`, sin servicio. Backend `api/reportes/router.py:29-117` (ingresos, por-vencer, asistencia, inactivos, exportar) sin consumir | ninguno |

### 13 · Auditoría

| Vista | Ruta | Archivo | Tipo | Roles / guard | Muestra | Acciones | Datos | Estados |
|---|---|---|---|---|---|---|---|---|
| Auditoría | — | — | **no existe** | — | — | — | Backend `GET /my-gym/auditoria`, `/auditoria/filtros` (`api/my_gym/router.py:239,278`) sin consumir | — |

### ?? · Sin módulo

| Vista | Archivo | Por qué no encaja |
|---|---|---|
| Selector de tenant (Header y Login) | `Header.tsx:95-150`, `LoginPage.tsx:116-140`, `TenantThemeContext.tsx:5-42` | Cambia el gimnasio activo desde el cliente entre 4 presets hardcodeados. Ningún módulo 00–13 contempla cambiar de gimnasio dentro del sistema web |
| Acceso rápido Demo | `LoginPage.tsx:175-214`, `AuthContext.tsx:84-114` | Sesión falsa con permisos inventados por rol; no es una función del producto |

---

## B. Componentes transversales

| Componente | Archivo | En uso | Observación |
|---|---|---|---|
| Layout + sidebar + header | `components/layout/AppLayout.tsx`, `Sidebar.tsx`, `Header.tsx` | sí | Sidebar responsive; Header consulta caja al cambiar `tenant.id` |
| Guard de ruta | `components/layout/ProtectedRoute.tsx` | sí, **solo `isAuthenticated`** | Soporta `requiredSubmodule`/`requiredAction` (`:82-83,104`) pero `App.tsx` nunca los pasa: ninguna ruta valida permiso, solo el menú los oculta |
| Tabla paginada | `components/ui/Table.tsx:26` | sí (6 páginas) | `isLoading`, `emptyMessage` (`:30`), paginación prev/next (`:98-130`); sin selector de tamaño |
| `EmptyState`, `LoadingSpinner` | `Table.tsx:145,184` | sí | — |
| Avisos flotantes | `contexts/ToastContext.tsx:21` | sí, para éxito **y error** | Todos los errores de API se muestran como toast (`showToast('error', …)` en todas las páginas); no hay mensaje fijo en pantalla |
| Modal | `components/ui/Modal.tsx:14` | sí | — |
| Diálogo de confirmación | `components/ui/Modal.tsx:83` (`ConfirmDialog`) | **no** | Definido, cero usos. Cancelar clase (`ClasesPage.tsx:149`) y descongelar (`MembresiasPage.tsx:168`) ejecutan sin confirmar |
| Badge, Avatar, Card, KpiCard, Input, Select, Textarea, SearchInput, Button | `components/ui/*` | sí | — |
| Banner de suscripción / bloqueo del gimnasio | — | **no existe** | Cero ocurrencias de `suspendid`/`bloquead`/`GIMNASIO_` en `src/` |
| Selector de gimnasio | `Header.tsx:95-150`, `LoginPage.tsx:116-140` | sí | Ver §D |
| Manejo global de errores | `api/client.ts:45-112` (interceptor), `parseApiError` (`:114-140`) | sí | 401 → refresh y reintento; sin refresh o refresh fallido → evento `gymos_session_expired`. 403/409 → texto genérico (`:131-136`). **404, 422 y `GIMNASIO_SUSPENDIDO` sin trato específico** |
| Detección de tenant | `contexts/TenantThemeContext.tsx:118-131` | sí | Orden: `?subdominio=` → hostname → `localStorage`. Branding público: `GET /my-gym/public-branding/{sub}` (`:185`) |

---

## C. Navegación real

Ítems de `Sidebar.tsx:32-140` filtrados por `hasPermission(sub,'leer')` (`AuthContext.tsx:135-150`); el jefe tiene `['*']`. Las rutas **no** validan permiso: cualquier rol autenticado puede escribir la URL directamente.

| Ítem (orden del menú) | Ruta | Jefe | Recepcionista | Entrenador |
|---|---|---|---|---|
| Dashboard | `/` | ✓ | ✓ (`show: true`) | ✓ |
| Control de Ingreso | `/control-ingreso` | ✓ | según matriz `control_ingreso` | según matriz |
| Caja y Turnos | `/caja` | ✓ | `caja` | `caja` |
| Deportistas | `/deportistas` | ✓ | `deportistas` | `deportistas` |
| Membresías y Planes | `/membresias` | ✓ | `membresias` | `membresias` |
| Entrenamiento | `/entrenamiento` | ✓ | `entrenamiento` | `entrenamiento` |
| Clases y Reservas | `/clases` | ✓ | `clases` | `clases` |
| Pantalla Recepción (TV) | `/pantalla-tv` | ✓ | ✓ (`show: true`) | ✓ |
| Inventario | `/inventario` | ✓ | `inventario` | `inventario` |
| Personal y Permisos | `/personal` | ✓ | `personal` | `personal` |
| Reportes y Métricas | `/reportes` | ✓ | `reportes` | `reportes` |
| Configuración MyGymOS | `/configuracion` | ✓ | `configuracion` | `configuracion` |

La visibilidad real por rol depende de `platform.permisos_rol` en la base (`GET /auth/permisos/matriz`), no del código: `NO VERIFICADO` qué filas trae el seed. En modo Demo los permisos son los de `AuthContext.tsx:92-103`.

---

## D. Señales de riesgo en el frontend

| # | Señal | Evidencia |
|---|---|---|
| 1 | **Tokens en `localStorage`**: access, refresh, usuario y subdominio | `contexts/AuthContext.tsx:64-67`; el interceptor los lee de ahí (`api/client.ts:33,74`) |
| 2 | **Sesión Demo sin backend**: token `mock_jwt_token_demo_gymos` y permisos inventados; accesible desde el login de producción | `AuthContext.tsx:84-114`, `LoginPage.tsx:175-214` |
| 3 | **Permisos validados solo en la UI**: el guard por submódulo existe pero no se usa; el menú oculta, la ruta no bloquea | `ProtectedRoute.tsx:104` vs `App.tsx:39-53` |
| 4 | **Selector de gimnasio en cliente**: 4 presets hardcodeados que no existen en la base; cambiarlo pisa el tenant activo | `TenantThemeContext.tsx:5-42,228-239`; `Header.tsx:122-127`; `LoginPage.tsx:116-140` |
| 5 | **Endpoints que no coinciden con el backend** (5): `GET/POST /membresias/planes` (BE: `/planes`); `POST /clases/{id}/cancelar` (BE: `PATCH`); `POST /entrenamiento/rutinas-asignadas` (BE: `/asignar-rutina`); `GET /entrenamiento/rutinas-asignadas/deportista/{id}` (BE: `/deportistas/{id}/rutinas`); `POST …/personalizar` (BE: `PUT`) | `api/membresias.service.ts:19,24` vs `api/membresias/router.py:29,37`; `api/clases.service.ts:35` vs `router.py:170`; `api/entrenamiento.service.ts:55,60,70` vs `router.py:364,396,479` |
| 6 | **Venta de producto sin `producto_id`**: la UI manda descripción libre y precio fijo; el backend exige el UUID para `tipo=='producto'` | `CajaPage.tsx:470-488,541`; `api/caja/schemas.py:50` |
| 7 | **Precio unitario editable por el cajero** sin permiso, motivo ni registro | `CajaPage.tsx:518` |
| 8 | **Configuración no persiste**: branding y los 3 parámetros del gimnasio solo van a contexto/`localStorage`; el backend tiene los endpoints | `ConfiguracionPage.tsx:19-32`; `TenantThemeContext.tsx:45,241-255`; `api/my_gym/router.py:91,114` |
| 9 | **KPIs con valores inventados** cuando el real es 0 o falla: 142 deportistas, 38 ingresos, 6 clases; Reportes es 100 % fijo | `DashboardPage.tsx:118,124,148`; `ReportesPage.tsx:20-55` |
| 10 | **Fechas sin zona explícita**: `toLocaleTimeString([])` / `toLocaleDateString([])` usan la zona del navegador; el default del formulario de clase es UTC (`toISOString().slice(0,16)` en un `datetime-local`) | `CajaPage.tsx:286`; `ClasesPage.tsx:43,191,198`; `ControlIngresoPage.tsx:300`; `DashboardPage.tsx:228` |
| 11 | **Montos**: `Number(x).toLocaleString()` sin `'es-CO'` ni `maximumFractionDigits`; el backend usa `Decimal` en `precio_unitario` | `CajaPage.tsx:237-257,332,394,431`; `MembresiasPage.tsx:408,517`; `api/caja/schemas.py:53` |
| 12 | **Vocabulario de estado inconsistente**: la lista de deportistas usa `al_dia`/`en_mora` (SQL en `api/deportistas/service.py:210-223`), el dominio devuelve `activo`/`mora`/`inactivo`/`cancelada` (`api/membresias/domain.py:36-151`) y la UI mapea solo el primero (`DeportistasPage.tsx:244-258`). Ambos son calculados, no guardados ✓ |
| 13 | **Huella activa en la UI**: "Simular Huella" con UUID fijo, "Enrolar Huella" en la ficha, columna "Método" en historial | `ControlIngresoPage.tsx:91-93,143`; `DeportistasPage.tsx:227-240,525` |
| 14 | **Sin trato de `GIMNASIO_SUSPENDIDO` / 403 / 404 en pantalla**: solo toast genérico | `api/client.ts:131-136`; cero ocurrencias del código en `src/` |
| 15 | **Sesión expirada no conserva la ruta**: redirige a `/login` sin `state`/`returnTo` | `ProtectedRoute.tsx:101` |
| 16 | **Acciones destructivas sin confirmación**: cancelar clase, descongelar | `ClasesPage.tsx:149-158`; `MembresiasPage.tsx:168-176` |

---

## E. Resumen

| Módulo | Vistas (página/tab/modal) | Reales (API) | Parciales (API⚠ o incompletas) | Mock | Sin vista |
|---|---|---|---|---|---|
| 00 Transversales | 4 | 3 (layout, header, dashboard) | 1 (dashboard con fallbacks fijos) | 0 | — |
| 01 Autenticación | 1 | 1 (login) | — | 1 (demo) | recuperar contraseña |
| 02 MyGymOS | 1 | 0 | 0 | 1 | landing/QR, métodos de pago, info general |
| 03 Personal | 1 | 1 (matriz) | — | 0 | CRUD de staff, transferir jefe |
| 04 Planes | 1 tab + 1 modal | 0 | 2 (ruta `/membresias/planes` no existe en BE) | 0 | editar/desactivar plan |
| 05 Inventario | 1 + 1 modal | 0 | 0 | 2 | entradas, ajustes, kardex |
| 06 Deportistas | 1 + 4 modales | 5 | 1 (ficha no pinta pagos/accesos) | 0 | desactivar, supresión 1581 |
| 07 Membresías | 1 tab + 4 modales | 5 | 0 | 0 | ficha de membresía |
| 08 Caja | 1 + 4 modales | 4 | 1 (venta de producto sin `producto_id`) | 0 | pago membresía, anular venta/pago, cierre forzado |
| 09 Ingreso + TV | 2 + 2 modales | 4 | 0 | 0 (simulador huella es DEMO) | config de pantalla |
| 10 Entrenamiento | 2 tabs + 3 modales | 3 | 2 (asignar rutina ruta errada; crear plantilla sin modal) | 0 | rutinas por deportista, personalizar |
| 11 Clases | 1 + 3 modales | 4 | 1 (cancelar con método errado) | 0 | editar clase, cancelar reserva, cerrar, calificar |
| 12 Reportes | 1 | 0 | 0 | 1 | todo (ingresos, por vencer, asistencia, exportar) |
| 13 Auditoría | 0 | — | — | — | consulta de auditoría |
| **Total** | **≈41** | **30** | **8** | **5** | — |

Endpoints del backend: 118 rutas en 12 routers; el frontend consume **≈45** (37 con ruta correcta, 5 con ruta/método errado, 3 solo en servicios sin uso desde pantalla — ver §A). Los módulos **inventario, reportes, personal (staff), my_gym (salvo `/status` y branding público) y auditoría** no tienen ningún consumidor.

➡️ **Fin de la Fase 1.** Esperando "continúa" para la Fase 2 (cruce con `requisitos_consolidados_sistema-web.md`).
