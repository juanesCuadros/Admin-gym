# Refactor de vistas — Tandas 0 y 1

Implementa directamente en `Admin-GYM` (Sistema Web del Gimnasio). No escribas documentos de diseño: escribe código. Este archivo es la especificación.

Referencias: `docs/requisitos_consolidados_sistema-web.md` para los GW-RF, `docs/inventario_vistas_admin-gym.md` para saber qué existe hoy. Si el código contradice este archivo, manda este archivo.

---

# Parte A · Reglas globales (aplican a todo el refactor)

## A1. Formato

- Español, sentence case en títulos y botones.
- Dinero: COP enteros, `es-CO`, sin decimales → `$80.000`. Una sola utilidad `formatCOP`.
- Fechas: `dd/mm/aaaa`, hora 24 h, **siempre America/Bogota**, sin importar el reloj del navegador. Una sola utilidad `formatFecha` / `formatFechaHora`.
- Fecha relativa solo como complemento: "Vence en 3 días (15/10/2026)".
- Tablas de 20 filas.
- Documento con tipo: `CC 1061234567`.

## A2. Estados compartidos

Crea componentes reutilizables y úsalos en todas las vistas:

| Estado | Comportamiento |
|---|---|
| Cargando | Esqueleto en el área de contenido; header y menú visibles |
| Vacío por filtro | "No hay resultados" y botón para limpiar filtros |
| Vacío inicial | Explica la pantalla y ofrece la acción de crear el primero |
| Error de carga | **Mensaje fijo** con botón "Reintentar". Nunca aviso flotante |
| 403 | Saca al usuario de la vista con mensaje fijo: perdió el permiso |
| 404 | "No encontrado". También para recursos de otro gimnasio: nunca 403 |
| 409 | "Otra persona modificó este registro" + recargar |
| Gimnasio bloqueado | Pantalla completa de servicio no disponible (§B5) |
| Sesión expirada | Login **conservando la ruta** para volver después |

## A3. Mensajes

- Éxito → aviso flotante.
- Error → mensaje fijo, junto al campo o arriba del formulario.
- 422 del servidor → se pinta en el campo que lo causó.
- Acción destructiva → `ConfirmDialog` (ya existe en `components/ui/Modal.tsx` y no se usa). Aplica a anular, cancelar, desactivar, descongelar, eliminar y suprimir.
- Acciones que exigen **motivo escrito**: anular venta, anular pago, cancelar membresía, cancelar clase, cortesía, ajuste de stock, descuento, cierre con descuadre, desactivar deportista con membresía vigente, suprimir datos.

## A4. Estado del deportista (un solo enum en todo el sistema)

`desactivado` · `cancelado` · `sin_membresia` · `congelado` · `vencido` · `en_gracia` · `por_vencer` · `activo`

Se calcula, nunca se guarda. **Prohibido** `al_dia`, `en_mora` e `inactivo`; si aparecen en el backend, anótalo en el reporte.

| Estado | Color | Texto |
|---|---|---|
| `activo` | Verde | Activo |
| `por_vencer` | Ámbar | Vence en N días |
| `en_gracia` | Ámbar | Vencido hace N días |
| `vencido` | Rojo | Vencido |
| `congelado` | Azul | Congelado hasta dd/mm |
| `cancelado` · `sin_membresia` · `desactivado` | Gris | El nombre del estado |

## A5. Permisos, en tres capas

1. El menú oculta lo que no se puede leer.
2. La ruta bloquea si se escribe la URL directamente (`requiredSubmodule` ya existe en `ProtectedRoute`, hoy no se pasa nunca).
3. El backend valida en cada petición. Es la única capa que cuenta.

## A6. Formularios

- Validación al salir del campo, más la del servidor.
- Botón deshabilitado mientras la petición corre: nada de doble envío.
- Operaciones de dinero con `Idempotency-Key`; el reintento conserva la misma clave.
- Salir con cambios sin guardar pide confirmación.
- Si falla el guardado, **no se pierde lo escrito**.
- Campos de solo lectura se ven deshabilitados, no ocultos.

## A7. Prohibiciones

- **Cero datos inventados.** Si la API falla o devuelve 0, se muestra 0 o el estado vacío. Elimina los fallbacks actuales de `DashboardPage` (142/38/6) y `ReportesPage` (100 % fijo).
- Cero mocks nuevos. Si el endpoint no existe, la vista no se implementa: se reporta.
- No toques el backend salvo donde la tanda lo autorice; lo demás se anota.
- Nada en la UI sobre huella, torniquete, modo sin internet, abonos, saldo a favor, reapertura de turnos, lista de espera ni facturación electrónica.

---

# Parte B · Tanda 0 · Base transversal

Sin esto, cada tanda siguiente repite los mismos errores. Backend permitido: **ninguno**.

## B1. Limpieza

- Elimina el "Acceso rápido Demo" de `LoginPage` y el token `mock_jwt_token_demo_gymos` de `AuthContext`.
- Elimina el selector de gimnasio del header y del login, y los `TENANT_PRESETS`. El tenant sale del subdominio, con el orden actual de detección menos el override manual.
- Elimina los KPI de relleno del dashboard y los datos fijos de reportes.

## B2. Navegación

Dos grupos en el sidebar. Cada módulo se muestra según el permiso de lectura de su submódulo.

| Grupo | Módulo | Ruta | Submódulos (acordeón) |
|---|---|---|---|
| Operación | Inicio | `/` | — |
| | Control de ingreso | `/control-ingreso` | Check-in · Ingresos de hoy · Pantalla TV |
| | Caja | `/caja` | Turno actual · Punto de venta · Historial de turnos |
| | Deportistas | `/deportistas` | — |
| | Membresías | `/membresias` | Membresías · Planes |
| | Clases | `/clases` | — |
| | Entrenamiento | `/entrenamiento` | Ejercicios · Plantillas · Rutinas asignadas |
| | Inventario | `/inventario` | Productos · Movimientos de stock |
| | Reportes | `/reportes` | Ingresos · Membresías · Asistencia |
| Administración | Personal | `/personal` | Staff · Permisos |
| | Configuración | `/configuracion` | General · Landing · Métodos de pago · Parámetros |
| | Auditoría | `/auditoria` | — |

- Las vistas de detalle (ficha de deportista, detalle de clase, ficha de producto) **no** van en el menú.
- El acordeón solo se despliega en el módulo activo.
- Crea las rutas con su `requiredSubmodule`; las que aún no tengan pantalla muestran un estado vacío de "en construcción", sin datos falsos.

## B3. Header

Nombre y logo del gimnasio · franja de estado de la suscripción (§B4) · estado de caja · usuario con rol · salir. Sin selector de gimnasio.

## B4. Estado de la suscripción

Leído del backend, no calculado en el cliente.

| Situación | Qué se ve |
|---|---|
| Faltan 5 días o menos para el corte | Franja con contador, visible para todos los roles |
| Días 1 a 3 después del corte | Franja de advertencia; el sistema funciona normal |
| Bloqueado, suspendido, cancelado o prueba vencida | Pantalla completa de servicio no disponible |

## B5. Pantalla de servicio no disponible

Ruta `/bloqueado`, pública. Se llega al intentar entrar o cuando una petición devuelve `GIMNASIO_SUSPENDIDO`.

- Muestra: nombre del gimnasio, motivo en lenguaje llano (falta de pago, suspendido por MVC, cancelado, prueba vencida, subdominio inexistente) y contacto de MVC.
- **No** muestra fecha de corte, monto ni deuda: eso es entre MVC y el dueño.
- Acciones: reintentar y copiar contacto.
- Si MVC registra el pago, el siguiente "Reintentar" deja entrar, sin esperar ningún proceso.

## B6. Interceptor de errores

`api/client.ts`: 401 con refresh y reintento (ya existe, consérvalo); 403, 404, 409 y 422 con códigos distinguibles para que cada vista los pinte según §A2; `GIMNASIO_SUSPENDIDO` redirige a `/bloqueado`. Evita el bucle de refrescos si el refresh falla.

---

# Parte C · Tanda 1 · Autenticación

Cinco vistas, todas fuera del layout autenticado. Backend permitido: **ninguno**; los servicios ya existen en `api/auth.service.ts`.

## C1. Login · `/login`

**Muestra:** logo y nombre del gimnasio desde el branding público del subdominio · correo · contraseña con botón para verla · enlace "¿Olvidaste tu contraseña?".

**Al ingresar, en este orden:**
1. Contraseña temporal o marcada para cambio → `/cambiar-clave`.
2. Rol Recepcionista sin turno abierto → `/caja` con el modal de abrir turno y sin poder navegar a otra cosa.
3. Resto → la ruta guardada, o Inicio.

**Casos de borde:**

| Caso | Comportamiento |
|---|---|
| Credenciales malas, correo inexistente o usuario desactivado | **El mismo** mensaje genérico en los tres casos |
| 5 intentos fallidos | Bloqueo de 15 min; durante el bloqueo incluso la contraseña correcta recibe el mensaje genérico. Un ingreso exitoso reinicia el contador |
| Usuario de otro gimnasio | Mensaje genérico. Nunca se revela que existe en otro subdominio |
| Contraseña temporal vencida (72 h) | Mensaje: pedir una nueva al Jefe, o a MVC si es el Jefe |
| Gimnasio bloqueado | No se valida contraseña: va a `/bloqueado` |
| Llega desde una URL protegida | Tras ingresar vuelve a esa ruta |
| Doble clic en Ingresar | Un solo intento |

## C2. Solicitar recuperación · `/recuperar`

Campo de correo y enlace para volver. Al enviar, la confirmación **reemplaza** el formulario.

| Caso | Comportamiento |
|---|---|
| Correo inexistente o usuario desactivado | La misma confirmación. No se revela nada |
| Varias solicitudes | Se permiten; solo sirve el último enlace |
| Gimnasio bloqueado | `/bloqueado` |

## C3. Definir nueva contraseña · `/recuperar/{token}`

El token se valida al cargar, antes de mostrar el formulario. Muestra nueva contraseña, confirmación y las reglas visibles desde el inicio, no solo cuando falla.

| Caso | Comportamiento |
|---|---|
| Enlace usado o con más de 1 h | Rechazo con enlace para pedir otro |
| Cambio exitoso | Se cierran **todas** las sesiones del usuario |
| Dos pestañas con el mismo enlace | La segunda recibe token inválido |

## C4. Cambio obligatorio · `/cambiar-clave`

Requiere sesión y **bloquea la navegación**: sin menú, y cualquier otra ruta redirige aquí. Muestra por qué se pide, la contraseña actual (la temporal), la nueva y su confirmación.

| Caso | Comportamiento |
|---|---|
| Intenta navegar a otra ruta | Vuelve aquí |
| La temporal vence estando en la pantalla | Se cierra la sesión; el login indica que pida una nueva |
| Nueva igual a la temporal | Se rechaza en el campo |

## C5. Servicio no disponible · `/bloqueado`

Ya construida en la tanda 0 (§B5). Aquí solo conecta el flujo desde el login.

## C6. Transversales de sesión

- Expiración por inactividad según el parámetro del gimnasio, 1 h por defecto: aviso, limpieza y login **conservando la ruta**.
- El refresh token rota en cada uso; si el refresh falla, no reintentar en bucle.
- Cerrar sesión revoca el refresh en el servidor y limpia el estado local.
- **Pendiente de decisión, no lo cambies todavía:** hoy los tokens viven en `localStorage`. Lo correcto sería refresh en cookie `HttpOnly` y access en memoria. Anótalo en el reporte.

---

# Reporte al terminar cada tanda

```
Tanda N — <nombre>
Creados:     …
Modificados: …
Eliminados:  …
Endpoints consumidos: …
Pendiente:   … (con el motivo)
Desalineaciones con el backend encontradas y NO corregidas: …
```

Un commit por tanda. Detente al terminar la tanda 1 y espera instrucciones.
