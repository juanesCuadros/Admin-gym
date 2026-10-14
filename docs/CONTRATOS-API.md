# GymOS — Contratos de la API para el desarrollo en paralelo

**Fecha:** 13-oct-2026. Lo que cada carril de backend **entrega** y lo que cada carril de frontend **consume**.
El backend implementa exactamente esto; el frontend programa contra esto aunque el backend no esté unido todavía.
Cambiar un contrato exige avisar a Juan: no se cambia en silencio.

**Convenciones**
- Sistema Web (GW): prefijo `/api/v1`, Bearer JWT, multi-tenant por subdominio.
- Super-Admin (SA): prefijo `/api/v1`, rutas internas bajo `/admin`, públicas bajo `/public` (sin autenticación).
- Error: `{"codigo": "MAYUSCULAS", "mensaje": "texto para el usuario", "detalles": {...}?}`.
- Fechas `YYYY-MM-DD` (Bogotá); instantes ISO-8601 en UTC; dinero en COP enteros.
- Estado del deportista: `desactivado | cancelado | sin_membresia | congelado | vencido | en_gracia | por_vencer | activo`.
- Tablas y funciones de BD compartidas: `infra/db/migrations/003_base_compartida.sql` (ya en `main`).

---

## Carril 1 · Caja y membresías (GW)

### 1.1 Turno único por gimnasio (GW-RF-08)
| Método y ruta | Cambio |
|---|---|
| `POST /caja/turnos/abrir` | Si hay un turno abierto de **otra** persona → `409 TURNO_AJENO_ABIERTO`, `detalles: {turno_id, abierto_por_nombre, abierto_en}` |
| `POST /caja/turnos/{turno_id}/cerrar-ajeno` **(nuevo)** | Body `{conteo_efectivo: int, nota?: str}`. Respuesta = la de `POST /caja/turnos/cerrar` + `{cerrado_por_nombre, descuadre_atribuido_a_nombre}`. Permiso `caja:crear` |
| `GET /caja/turnos/actual` | Agrega `es_propio: bool` y `abierto_por_nombre` |

### 1.2 Descuentos y precio editable (GW-RF-53)
Aplica a cada ítem de `POST /caja/ventas` y a `POST /caja/pagos-membresia`:

| Campo nuevo en la petición | Regla |
|---|---|
| `precio_cobrado?: int` | Si se omite, se cobra el precio de lista |
| `motivo_descuento?: str` | Obligatorio si `precio_cobrado` < precio de lista |

Respuesta: cada ítem y cada pago agregan `precio_lista`, `precio_cobrado`, `descuento_pct`.
Errores: `403 DESCUENTOS_DESHABILITADOS` (parámetro del gimnasio), `403 SIN_PERMISO_DESCUENTO`,
`422 DESCUENTO_SUPERA_TOPE` (`detalles: {tope_pct}`), `422 MOTIVO_DESCUENTO_REQUERIDO`.
Parámetros que lee: `tenant.permitir_descuentos`, `tenant.tope_descuento_pct` (migración 003).

### 1.3 Planes grupales (GW-RF-52)
| Método y ruta | Contrato |
|---|---|
| `POST /membresias/paquetes` **(nuevo)** | Body `{plan_id, titular_id, beneficiarios: [uuid], fecha_inicio?}` (el titular va incluido en `beneficiarios`). Respuesta `{paquete_id, membresias: [{id, deportista_id, deportista_nombre, fecha_inicio, fecha_vencimiento, precio_asignado}]}` |
| `POST /caja/pagos-membresia` | Acepta `paquete_id` en lugar de `membresia_id`: un solo pago cubre las N membresías |
| `GET /membresias/paquetes/{id}` **(nuevo)** | `{id, plan_nombre, titular: {id, nombre, telefono}, membresias: [...]}` |
| `GET /deportistas/{id}` (ficha) | `membresia_actual` agrega `paquete_id?` y `titular_nombre?` *(`deportistas/` es del carril 2: el carril 1 lo agrega en su última tarea, cuando el carril 2 ya esté unido a `main`)* |

Errores: `422 BENEFICIARIOS_INCOMPLETOS` (`detalles: {requeridos, recibidos}`), `422 TITULAR_MENOR_DE_EDAD`,
`422 TITULAR_NO_ES_BENEFICIARIO`, `409 BENEFICIARIO_DUPLICADO`.

### 1.4 Copia del plan en la venta (GW-RF-24 CA2) y regla C2 (GW-RF-25 CA2)
Sin cambio de contrato: las respuestas de membresía agregan `plan_precio_vendido`, `plan_duracion_dias_vendida`.

---

## Carril 2 · Clientes, ingreso, configuración y personal (GW)

### 2.1 Estado único del deportista
`GET /deportistas`, `GET /deportistas/buscar`, `GET /deportistas/{id}` y `POST /control-ingreso/checkin-manual`:
el campo se llama **`estado`** y usa solo el enum consolidado. Se elimina `estado_membresia`.

### 2.2 Salidas (GW-RF-54)
| Método y ruta | Contrato |
|---|---|
| `POST /control-ingreso/salida` **(nuevo)** | Body `{deportista_id}`. Respuesta `{checkin_id, deportista_id, deportista_nombre, ingreso_ts, salida_ts, permanencia_minutos}`. `409 SIN_INGRESO_ABIERTO` |
| `GET /control-ingreso/adentro` **(nuevo)** | `{total, items: [{checkin_id, deportista_id, nombre, documento, ingreso_ts, minutos_adentro}]}` |
| `GET /control-ingreso/ingresos-hoy` | Cada fila agrega `salida_ts?` y `permanencia_minutos?`; las métricas agregan `adentro_ahora` |

### 2.3 Registro completo del deportista (GW-RF-17, 19)
`POST /deportistas` y `PUT /deportistas/{id}` agregan:
`tipo_documento: "CC"|"TI"|"CE"|"PAS"|"PPT"|"RC"` (obligatorio al crear), `acudiente: {nombre, tipo_documento, documento,
telefono, parentesco, autoriza: bool}?` (obligatorio si es menor de 18). Las respuestas agregan `tipo_documento`,
`acudiente`, `consentimiento_version`, `consentimiento_registrado_por_nombre`.
Errores: `409 DOCUMENTO_YA_REGISTRADO`, `422 ACUDIENTE_REQUERIDO`, `422 AUTORIZACION_ACUDIENTE_REQUERIDA`,
`409 LIMITE_PLAN_CLIENTES` (`detalles: {limite, actuales, plan_nombre}`).

### 2.4 Carga inicial (GW-RF-55)
| Método y ruta | Contrato |
|---|---|
| `GET /carga-inicial/plantilla?formato=csv\|xlsx` **(nuevo)** | Archivo con los encabezados |
| `POST /carga-inicial/simular` **(nuevo)** | `multipart/form-data` con `archivo`. `{filas_validas, filas_con_error, errores: [{fila, columna, codigo, mensaje}]}` |
| `POST /carga-inicial/aplicar` **(nuevo)** | Mismo archivo. Todo o nada. `{deportistas_creados, membresias_creadas}`. Solo Jefe. `422 CARGA_CON_ERRORES` con el mismo formato de `simular` |

Columnas: `tipo_documento, documento, nombre, telefono, correo, fecha_nacimiento, plan_nombre, fecha_vencimiento`.

### 2.5 Parámetros del gimnasio (GW-RF-48)
`GET /my-gym/info` y `PATCH /my-gym/parametros` agregan: `minimo_dias_congelamiento`, `permitir_descuentos`,
`tope_descuento_pct`, `ventana_reserva_dias`, `limite_cancelar_reserva_horas`. Fuera de rango → `422`.

### 2.6 Mi suscripción (planes del SaaS, lado del gimnasio)
| Método y ruta | Contrato |
|---|---|
| `GET /my-gym/plan` **(nuevo)** | `{plan_actual: {codigo, nombre, tipo, max_clientes_activos, max_staff}?, uso: {clientes_activos, staff}, solicitud_pendiente: {id, plan_nombre, solicitado_por, created_at}?}` |
| `GET /my-gym/planes` **(nuevo)** | `[{id, codigo, nombre, descripcion, precio, duracion_meses, max_clientes_activos, max_staff}]` |
| `POST /my-gym/plan/solicitud` **(nuevo)** | Body `{plan_id, nota?}`. `201 {id}`. `409 SOLICITUD_PENDIENTE_EXISTE`, `422 PLAN_NO_DISPONIBLE`. Solo Jefe |
| `DELETE /my-gym/plan/solicitud` **(nuevo)** | Cancela la pendiente. `404` si no hay. Solo Jefe |

Usa las funciones `platform.plan_actual`, `planes_disponibles`, `solicitud_plan_pendiente`, `solicitar_plan`,
`cancelar_solicitud_plan` (migración 003).

### 2.7 Personal con credencial temporal (GW-RF-39)
| Método y ruta | Contrato |
|---|---|
| `POST /personal` | Ya no recibe contraseña. Respuesta agrega `password_temporal` (se muestra **una sola vez**) y `expira_en` (72 h). `409 LIMITE_PLAN_STAFF` |
| `POST /personal/{id}/regenerar-credencial` **(nuevo)** | `{password_temporal, expira_en}`. Cierra las sesiones de esa persona |

### 2.8 Recepcionista sin turno (GW-RF-00.1 CA4)
`GET /auth/me` agrega `requiere_abrir_caja: bool` (true solo para recepcionista sin turno abierto en el gimnasio).

---

## Carril 3 · Super-Admin y SaaS (SA)

### 3.1 Planes de suscripción (SA-RF-33)
| Método y ruta | Contrato |
|---|---|
| `GET /admin/plans` | `[{id, codigo, nombre, descripcion, tipo, precio, duracion_meses, dias_prueba, max_clientes_activos, max_staff, activo, publico, orden, gimnasios_actuales}]` |
| `POST /admin/plans` | Body con los campos editables. `201`. `409 CODIGO_DUPLICADO` |
| `PUT /admin/plans/{id}` | Con `version`. `409` si cambió. `codigo` y `tipo` no se editan |
| `PATCH /admin/plans/{id}/status` | `{activo: bool}` |
| `GET /admin/plan-requests?estado=pendiente` | `[{id, gimnasio: {id, nombre, subdominio}, plan: {id, nombre, precio, duracion_meses}, solicitado_por, nota, created_at, estado}]` |
| `POST /admin/plan-requests/{id}/approve` | Header `Idempotency-Key`. Body `{monto, fecha_pago, metodo, nota?}`. Registra el pago (meses = `duracion_meses` del plan), crea la suscripción con `plan_id` y recalcula la fecha de corte |
| `POST /admin/plan-requests/{id}/reject` | `{motivo}` |
| `POST /admin/gyms` | `suscripcion` agrega `plan_id` (obligatorio) |
| `PATCH /admin/gyms/{id}/plan` | Cambio de plan manual por MVC: `{plan_id, vigente_desde}` |

### 3.2 Registro autónomo con prueba (SA-RF-34) — público
| Método y ruta | Contrato |
|---|---|
| `GET /public/plans` | Planes `activo` y `publico`, incluida la prueba |
| `GET /public/subdomain-check?nombre=` | `{subdominio_sugerido, disponible}` |
| `POST /public/signup` | Body `{nombre_gimnasio, ciudad, jefe_nombre, jefe_correo, telefono, acepta_terminos: true}`. **Siempre** `202 {mensaje}` (no revela si el correo existe). Envía enlace de confirmación (24 h) |
| `GET /public/signup/{token}` | `{valido: bool, nombre_gimnasio, subdominio_sugerido}`; `410` vencido o usado |
| `POST /public/signup/{token}/confirm` | Body `{password}`. Crea el gimnasio en `prueba` con el plan `prueba` (provisioning SA-RF-06). `{subdominio, url_login}`. `409 PRUEBA_YA_USADA` (mismo correo o teléfono) |

### 3.3 Estado calculado en el panel (SA-RF-01, 02, 32)
`GET /admin/dashboard/metrics` agrega `{en_gracia, bloqueados, pruebas_por_vencer, listos_para_eliminar, solicitudes_plan_pendientes, pruebas_nuevas_7d}`.
`GET /admin/gyms` agrega a cada fila `estado_calculado`, `dias_restantes`, `plan_nombre` y acepta `estado_calculado=` como filtro.
La fuente es `platform.estado_suscripcion()` (no se duplica la regla en Python).

### 3.4 Cancelación y eliminación (SA-RF-30, 31)
| Método y ruta | Contrato |
|---|---|
| `POST /admin/gyms/{id}/cancel` | Respuesta agrega `export_url`, `export_expira_en` (30 días) |
| `GET /public/exports/{token}` | Descarga el ZIP. `410` vencido o eliminado |
| `DELETE /admin/gyms/{id}` | Body `{confirmar_subdominio}`. Solo con 30 días cumplidos: `409 AUN_NO_ELIMINABLE` |
