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

### 1.5 Venta de membresía en un solo paso (decisión del 15-oct, migración 021)
Vender un plan crea la membresía **y** su cobro en la misma transacción. El cobro de una venta (`es_venta`) no
suma días: la vigencia es inicio + duración del plan. `POST /caja/pagos-membresia` queda para **renovar**.

| Método y ruta | Cambio |
|---|---|
| `POST /membresias/asignar` | Body agrega `pago` (obligatorio). Header `X-Idempotency-Key`. Exige `membresias:crear` **y** `caja:crear` y turno propio abierto. Respuesta agrega `pago` |
| `POST /membresias/paquetes` | Igual: `pago` cubre todo el paquete. Respuesta agrega `pago` |
| `POST /membresias/{id}/cambiar-plan` | Igual (`membresias:editar` + `caja:crear`). El plan nuevo empieza cuando termina el actual (GW-RF-25 CA3); si ya venció aplica la regla C2. `409 MEMBRESIA_CONGELADA` si está congelada hoy |

`pago = {monto, metodo, tipo_medio: "efectivo"|"otro", precio_cobrado?, motivo_descuento?, valor_recibido?}`, con las
mismas reglas y errores de descuento de 1.2 y `404 NO_HAY_TURNO_ABIERTO`. Reintento con la misma clave → la venta
original (201/200). Clave usada en otra operación → `409 CLAVE_IDEMPOTENCIA_EN_USO`.
Las renovaciones guardan en `dias_agregados` los días que sumaron. Anular el cobro de una venta deja la membresía sin
vigencia propia.
El header de idempotencia en todo el GW es `X-Idempotency-Key`.

### 1.7 Turno de una estación visto desde la web (decisión A1, 22-nov, migración 072)
Un turno abierto en una estación de GymDesk es de esa estación. Mientras siga abierto:

| Método y ruta | Cambio |
|---|---|
| `POST /caja/turnos/abrir` | `409 CAJA_EN_ESTACION` "La caja está abierta en la estación <nombre>", `detalles: {turno_id, estacion_nombre, abierto_por_nombre, abierto_en}` |
| `POST /caja/ventas`, `/caja/pagos-membresia`, `/caja/egresos`, `/caja/turnos/cerrar`, anular venta o pago (y lo que cobra a través de ellos: vender membresía, gasto en efectivo, reserva con cobro) | Sin turno propio de la web: `409 CAJA_EN_ESTACION` en lugar de `404 NO_HAY_TURNO_ABIERTO`. Nunca cobran ni anulan contra el turno de la estación, aunque lo haya abierto la misma persona |
| `POST /caja/turnos/{id}/cerrar-ajeno` | `409 TURNO_DE_ESTACION`: se cierra en la estación, con su arqueo |
| `POST /caja/turnos/{id}/cierre-forzado` | Sin cambio: el Jefe puede cerrarlo. Lo que la estación cobre después llega por revisar |
| `GET /caja/turnos/actual`, `GET /caja/turnos` | Agregan `estacion_id?` y `estacion_nombre?`. En `actual`, `es_propio` es `false` para un turno de estación |

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

Decisiones del 15-oct (Juan):
- `aplicar` recibe además el campo de formulario `declara_consentimientos=true`: el Jefe declara que el gimnasio
  conserva la autorización de datos (Ley 1581). Sin él → `422 DECLARACION_CONSENTIMIENTO_REQUERIDA`. Los clientes
  quedan con `consentimiento_version = 'migracion'`.
- Los menores de 18 años no se cargan: error de fila `MENOR_DE_EDAD` (se registran a mano con su acudiente).
- Respeta el límite del plan SaaS: `409 LIMITE_PLAN_CLIENTES` con `detalles: {limite, actuales, a_cargar, plan_nombre}`
  (también en `simular`).
- Plan y vencimiento van juntos; si los dos están vacíos el cliente se crea sin membresía. Fechas `dd/mm/aaaa` o
  `aaaa-mm-dd`. CSV separado por `;` o `,`. Máximo 5 MB (`413 ARCHIVO_DEMASIADO_GRANDE`) y 5.000 filas.
- Errores de fila: `TIPO_DOCUMENTO_INVALIDO`, `DOCUMENTO_REQUERIDO`, `DOCUMENTO_INVALIDO`, `DOCUMENTO_REPETIDO`,
  `DOCUMENTO_YA_REGISTRADO`, `NOMBRE_REQUERIDO`, `NOMBRE_INVALIDO`, `TELEFONO_INVALIDO`, `CORREO_INVALIDO`,
  `FECHA_INVALIDA`, `MENOR_DE_EDAD`, `PLAN_NO_EXISTE`, `PLAN_REQUERIDO`, `VENCIMIENTO_REQUERIDO`. Errores del
  archivo: `FORMATO_NO_SOPORTADO`, `ARCHIVO_INVALIDO`, `ARCHIVO_VACIO`, `PLANTILLA_INVALIDA` (`detalles.faltantes`),
  `DEMASIADAS_FILAS`.

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

## Usabilidad · Tanda 1 (GW)

| Método y ruta | Cambio |
|---|---|
| `GET /control-ingreso/historial` **(nuevo)** | Query `desde`, `hasta` (días de Bogotá, ambos incluidos), `limit`, `offset`. Responde `{desde, hasta, resumen: {total_registros, accesos_abiertos, alertas_mora, accesos_negados, cortesias}, items}`. `422 RANGO_FECHAS_INVALIDO` si `hasta < desde`. Permiso `control_ingreso:leer` |
| `GET /caja/turnos` **(nuevo)** | Query `desde`, `hasta` (días de Bogotá sobre la apertura), `estado` (por defecto `cerrado`), `staff_id`, `con_descuadre`, `pagina`, `limite`. Responde `{items: TurnoResumenDto + {estado_revision, revisado_por_nombre}, total, pagina, limite, total_paginas}`. `422 RANGO_FECHAS_INVALIDO` si `hasta < desde`. Permiso `caja:leer` |
| `POST /caja/ventas` | Una venta con `pase_dia` sin `deportista_id` responde `422 PASE_DIA_REQUIERE_CLIENTE` (GW-RF-17 CA3) |
| `POST /control-ingreso/checkin-manual` y `checkin-huella` | **Decisión de Juan (4-nov):** un pase de día sin anular, comprado hoy (día de Bogotá) por esa persona, da `resultado: abrio` aunque no tenga membresía al día. Sirve para reingresar ese mismo día. Al deportista desactivado se le sigue negando |

### Pago mixto (migración 060)
`POST /caja/ventas`, `POST /caja/pagos-membresia` y el `pago` de `/membresias/asignar` aceptan `tipo_medio: "mixto"` con `pagos: [{metodo, tipo_medio: efectivo|otro, monto}]` (mínimo dos). La suma debe ser exacta (`422 MEDIOS_NO_SUMAN_TOTAL`). `valor_recibido` se compara solo con la parte en efectivo. Las respuestas de venta traen `medios`. Anular devuelve a cada medio lo que se pagó con él: en una venta mixta se ignora `tipo_medio_reembolso`.

### Turno de trabajo (migración 065)
`GET /turnos-trabajo/mio`, `POST /turnos-trabajo/entrada` y `/salida`: cualquier persona del equipo, sobre su propio turno (`409 TURNO_TRABAJO_YA_ABIERTO`, `SIN_TURNO_TRABAJO_ABIERTO`). `GET /turnos-trabajo?desde&hasta&staff_id`: permiso `personal:leer`; trae los turnos y el resumen de horas por persona (los abiertos no suman). `POST /turnos-trabajo/{id}/cerrar`: solo el Jefe, body `{salida_en, motivo}`.

`POST /pantalla-tv/sesion`: permiso `control_ingreso:leer`; credencial de 16 horas para abrir la pantalla desde la sesión (GW-RF-07 CA4). `requiere_abrir_caja` en `/auth/me` sigue existiendo, pero el panel ya no la usa.

### Usabilidad · Tandas 2 a 4 (GW)
| Método y ruta | Qué hace |
|---|---|
| `POST /caja/turnos/{id}/revision` | Jefe. Body `{nota}`. Marca revisado un turno con descuadre; el arqueo no cambia. `409 TURNO_SIN_DESCUADRE` o `TURNO_YA_REVISADO` |
| `GET /membresias?grupo=activas\|vencidas\|canceladas` | Filtro en SQL: el total y la paginación corresponden al grupo |
| `GET /deportistas/mediciones` | Deportistas con su última medición. Query `q`, `limit`, `offset` |
| `POST /deportistas/{id}/mediciones` | `422 SEXO_Y_ESTATURA_REQUERIDOS` si ni la petición ni la ficha los tienen. Con sexo `otro` no se calcula grasa ni músculo |
| `GET, POST /clases/catalogo`, `PUT /clases/catalogo/{id}` | Clases que ofrece el gimnasio. `409 CLASE_CATALOGO_DUPLICADA` |
| `GET /my-gym/public-landing/{subdominio}` | Público. Solo datos pensados para el visitante |
| `GET /my-gym/public-imagen/{subdominio}/{logo\|banner}` | Público. La imagen subida |
| `POST, DELETE /my-gym/imagen/{logo\|banner}` | `configuracion:editar`. PNG, JPG o WEBP de hasta 3 MB. `422 IMAGEN_NO_VALIDA`, `413 IMAGEN_MUY_GRANDE` |
| `GET, POST /gastos`, `GET /gastos/beneficiarios`, `GET /gastos/resultado` | Permiso `gastos`. El POST exige `X-Idempotency-Key`; el efectivo exige turno propio y deja un egreso |
| `GET /gastos/entrenadores`, `PUT /gastos/entrenadores/{id}/config`, `POST /gastos/entrenadores/{id}/pagos` | Solo el Jefe. Liquidación por periodo: fijo, por clase realizada o comisión |
| `GET /membresias/avisos-vencimiento`, `POST /membresias/{id}/aviso` | Por vencer y en gracia; quién avisó y cuándo |

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

---

## Escritorio · GymDesk Escritorio (GW, migraciones 070 a 072)

Alcance y reglas en `ALCANCE_APP_ESCRITORIO.md`. El cuerpo de error real de la API es
`{"success": false, "error": {"codigo", "mensaje", "detalles"}}`; la estación lee `error.codigo`.

### E.1 Estaciones (solo el Jefe)
| Método y ruta | Contrato |
|---|---|
| `GET /estaciones` | `[{id, nombre, estado, codigo_expira_en?, activada_en?, nombre_equipo?, version_app?, ultima_sync_en?, revocada_en?, motivo_revocacion?, creada_por_nombre?, created_at}]`. `estado`: `por_activar`, `codigo_vencido`, `activa` o `revocada` |
| `POST /estaciones` | Body `{nombre}`. `201` con lo anterior + `codigo` (`XXXX-XXXX`, **se muestra una sola vez**, vence en 24 h). `409 ESTACION_NOMBRE_DUPLICADO` |
| `POST /estaciones/{id}/codigo` | Código nuevo para una estación sin activar. `409 ESTACION_YA_ACTIVADA`, `409 ESTACION_YA_REVOCADA` |
| `POST /estaciones/{id}/revocar` | Body `{motivo}`. La estación deja de sincronizar de inmediato. `409 ESTACION_YA_REVOCADA` |

Estación de otro gimnasio → `404 ESTACION_NO_ENCONTRADA`. Todo queda en auditoría.

### E.2 Activación e ingreso del personal
| Método y ruta | Contrato |
|---|---|
| `POST /sync/activar` (público) | Body `{subdominio, codigo, nombre_equipo?, version_app}`. Responde `{estacion_id, nombre, device_token, gimnasio: {id, nombre, subdominio}}`. El token viaja solo aquí; el servidor guarda su hash. `404 CODIGO_INVALIDO` (mismo mensaje para subdominio inexistente, código errado, usado o vencido), `429 ACTIVACION_BLOQUEADA` tras 5 fallos en 15 min, `403 GIMNASIO_SUSPENDIDO` |
| `POST /sync/sesion-staff` | Body `{correo, password}`. Primer ingreso de una persona en la estación: mismas reglas del login web. Responde `{staff: {id, nombre, correo, rol, password_cambiada_en?}, permisos: [str], servidor_ahora}`; nunca un hash. `401 CREDENCIALES_INVALIDAS` (también para desactivado), `429 CUENTA_BLOQUEADA_TEMPORALMENTE`, `409 DEBE_CAMBIAR_PASSWORD` |

Las rutas `/sync/*` (menos `activar`) llevan `Authorization: Bearer <device_token>`.
`401 ESTACION_NO_AUTORIZADA`, `401 ESTACION_REVOCADA`.

### E.3 Descarga · `GET /sync/pull?cursor=&limite=`
Sin `cursor` es la descarga inicial. `limite` 1–1000 (por defecto 500). Header opcional `X-GymDesk-Version`.

Responde `{epoca, reiniciar, cursor, hay_mas, cambios, eliminados: [{tabla, id}], suscripcion?, servidor_ahora}`.
Se repite con el `cursor` devuelto mientras `hay_mas` sea `true`. Si `reiniciar` es `true`, la estación borra su copia
y aplica lo que llega como descarga inicial.

`cambios` trae solo lo que recepción necesita:

| Clave | Campos |
|---|---|
| `gimnasio` | `id, nombre, subdominio, zona_horaria, dias_gracia_mora, dias_umbral_por_vencer, permitir_descuentos, tope_descuento_pct, metodos_pago, branding, duracion_sesion_minutos, precio_pase_dia?, precio_pase_clase?` (COP enteros; nulo = se escribe al cobrar, fase 3A) |
| `staff` | `id, nombre, correo, rol, activo, eliminado, password_cambiada_en` |
| `permisos` | `id, rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar` |
| `planes` | `id, nombre, precio (COP entero), duracion_dias, tipo, cupo_personas, activo` |
| `productos` | `id, nombre, precio (COP entero), stock, activo` |
| `deportistas` | `id, tipo_documento, documento, nombre, activo, eliminado` |
| `membresias` | `id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada, created_at` |
| `congelamientos` | `id, membresia_id, fecha_inicio, fecha_fin` (`fecha_fin` nulo = sigue congelada) |
| `pases_dia` | `id (de la venta), deportista_id, created_at, anulada`. Solo ventas con pase de día de los últimos 2 días y con cliente. Si la venta se anula vuelve a bajar con `anulada: true` |

En `eliminados`, la tabla de un pase de día borrado es `ventas`.

`suscripcion = {estado_guardado, fecha_corte, estado_calculado, motivo_bloqueo}`: con `fecha_corte` la estación calcula
el aviso y el bloqueo por su cuenta. Una fila puede llegar repetida entre rondas; la estación reemplaza por `id`.
`403 GIMNASIO_SUSPENDIDO` si el gimnasio está bloqueado, `422 CURSOR_INVALIDO`.

### E.4 Envío · `POST /sync/push`
**Se acepta aunque el gimnasio esté bloqueado:** lo ya cobrado sin red no se pierde.

Body `{operaciones: [{id, tipo, idempotency_key, ocurrida_en, staff_id?, depende_de: [id], payload}], estacion_ahora?}`,
de 1 a 50, en orden. `estacion_ahora` es el reloj del equipo al enviar: con él el servidor mide el desfase (ver "Hora de
los ingresos"). Siempre `200 {resultados: [{indice, id?, resultado, resultado_original?, codigo?, mensaje?, datos?, revision?}], servidor_ahora}`.

| `resultado` | Significado | Qué hace la estación |
|---|---|---|
| `aplicada` | Se validó, persistió y auditó | La saca de pendientes |
| `duplicada` | Ya se había recibido; `resultado_original` y `datos` son los de la primera vez. No es error | La saca de pendientes |
| `pendiente_revision` | Conflicto de negocio: **se registró** y quedó marcada; `revision: {motivo_codigo, motivo}` | La muestra en "Pendientes"; no la borra |
| `invalida` | Contenido mal formado; no se guardó nada. `codigo`: `OPERACION_MAL_FORMADA`, `TIPO_DESCONOCIDO`, `PAYLOAD_INVALIDO`, `STAFF_DESCONOCIDO`, `OPERACION_ID_REUTILIZADO`, `CLAVE_IDEMPOTENCIA_EN_USO` | Queda como `error` con alerta; nunca se descarta |
| `retenida` | Depende de una operación inválida, retenida o que no ha llegado (`DEPENDENCIA_PENDIENTE`); no se procesó | La reenvía cuando su dependencia se resuelva |

Tipos de operación:

| `tipo` | `payload` | Efecto |
|---|---|---|
| `auditoria_estacion` | `{accion, entidad, entidad_id?, detalle}` con `accion` en `CREAR_BASE_LOCAL, ACTIVAR_ESTACION, INICIAR_SESION, INGRESO_FALLIDO, BLOQUEAR_SESION, DESBLOQUEAR_SESION, CERRAR_SESION, CREAR_PIN, CAMBIAR_PIN, INVALIDAR_CREDENCIAL` | Queda en la auditoría del gimnasio como `ESTACION_<accion>`, con la hora de la estación. Si quien la hizo figura desactivado: `pendiente_revision` con `STAFF_DESACTIVADO` |
| `ingreso` (fase 2) | `{deportista_id, metodo: manual\|huella, resultado: abrio\|alerta_mora\|negado, estado, con_pase_dia}`. Exige `staff_id` | Inserta en `checkins` con la hora de la estación, `estacion_id`, `operacion_id` y `recibido_en`. **No vuelve a decidir** ni avisa a la Pantalla TV. `datos: {checkin_id, ts_utc}` |
| `cortesia` (fase 2) | `{motivo}` (4 a 255 letras). Exige `staff_id` | Inserta la cortesía en `checkins` y audita `INGRESO_CORTESIA` |
| `turno_abrir` (fase 3A) | `{base_inicial, sin_confirmar}`. Exige `staff_id`. El `id` de la operación es el del turno | Crea el turno con `estacion_id` y la hora de la estación; audita `ABRIR_TURNO_CAJA`. `datos: {turno_id, abierto_en}` |
| `venta` (fase 3A) | `{turno_id, deportista_id?, items: [{tipo: producto\|pase_dia\|pase_clase, producto_id?, descripcion, cantidad, precio_lista, precio_cobrado, motivo_descuento?}], total, tipo_medio: efectivo\|otro\|mixto, metodo, pagos?: [{metodo, tipo_medio, monto}], valor_recibido?}`. `depende_de: [turno_id]`. El `id` es el de la venta | Inserta venta, ítems, reparto (`cobro_medios`) y movimientos de stock en el turno de la estación, con su hora (el pase de día cuenta para ese día). Respeta el precio de la estación. Audita `REGISTRAR_VENTA_ESTACION`. `datos: {venta_id, turno_id, created_at}` |
| `egreso` (fase 3A) | `{turno_id, monto, motivo}`. `depende_de: [turno_id]` | Inserta el egreso en el turno de la estación; audita `REGISTRAR_EGRESO_CAJA` |
| `turno_cerrar` (fase 3A) | `{turno_id, efectivo_contado, total_esperado_efectivo, nota?}`. `depende_de: [turno_id]` | Cierra con el arqueo de la estación y la diferencia calculada por el servidor; audita `CERRAR_TURNO_CAJA`. `datos: {turno_id, estado, total_esperado_efectivo, diferencia}` |

`invalida` propias de estos tipos: `STAFF_REQUERIDO`, `DEPORTISTA_DESCONOCIDO` (cliente de otro gimnasio o inexistente),
`PAYLOAD_INVALIDO`. De la caja: `TURNO_DESCONOCIDO` (el turno no es de esta estación), `TURNO_YA_ABIERTO_EN_ESTACION`,
`TOTAL_NO_CUADRA`, `MEDIOS_NO_SUMAN_TOTAL`, `PAGO_INSUFICIENTE`, `PRODUCTO_ID_REQUERIDO`, `PRODUCTO_DESCONOCIDO`,
`PASE_DIA_REQUIERE_CLIENTE`, `MOTIVO_DESCUENTO_REQUERIDO`. Son errores de programación de la estación: ella valida lo
mismo antes de cobrar.

**Caja (fase 3A).** Un conflicto de negocio nunca rechaza dinero cobrado: se registra igual y queda `pendiente_revision`
sobre el movimiento (`entidad`: `turnos_caja`, `ventas` o `egresos_caja`) con uno de estos motivos:

| `motivo_codigo` | Cuándo |
|---|---|
| `TURNO_SIMULTANEO` | La estación abrió sin red y, al llegar, había (o hubo mientras tanto) otro turno abierto en la web u otra estación. Los dos quedan y cada uno se cierra con su arqueo. `detalle.otros_turnos` |
| `TURNO_CERRADO_EN_SERVIDOR` | Venta, egreso o cierre de un turno que el Jefe ya cerró a la fuerza. La venta y el egreso se guardan en ese turno; el cierre no lo toca y deja el arqueo de la estación en `detalle` |
| `PRECIO_DISTINTO` | El precio de la estación no es el actual. Se respeta el de la estación |
| `STOCK_NEGATIVO` | La venta deja el stock por debajo de cero. Se descuenta igual |
| `DESCUENTO_FUERA_DE_REGLA` | El descuento ya no cabe en la regla vigente (descuentos apagados, sin permiso o sobre el tope) |
| `PRODUCTO_INACTIVO` / `DEPORTISTA_DESACTIVADO` / `DEPORTISTA_DESCONOCIDO` | Se vendió un producto desactivado, o a un cliente desactivado o que ya no existe (la venta queda sin cliente) |
| `RESUMEN_NO_COINCIDE` | Al cerrar, el efectivo esperado de la estación y el del servidor no son iguales |
| `STAFF_DESACTIVADO` / `STAFF_SIN_PERMISO` / `RELOJ_DESFASADO` | Igual que en los ingresos, con el permiso `caja` |

`GET /sync/caja/turno-abierto` (con red, antes de abrir): `{abierto, turno_id?, es_de_esta_estacion, donde?, abierto_por_nombre?,
abierto_en?, consultado_en}`. Si `abierto` es `true`, la estación no abre (P-13 con red). Sin respuesta, abre igual con
`sin_confirmar: true`.

Un ingreso o una cortesía queda `pendiente_revision` (registrado igual, sin cambiar su resultado) con uno de estos
motivos. Si hay varios, manda el primero de la lista y los demás van en `detalle.otros_motivos`:

| `motivo_codigo` | Cuándo |
|---|---|
| `STAFF_DESACTIVADO` / `STAFF_SIN_PERMISO` | Quien lo registró figura desactivado, o su rol no tiene `control_ingreso.crear` |
| `ACCESO_NO_COINCIDE` | La estación dejó entrar y el servidor, con sus datos **del día del ingreso**, habría negado (membresía cancelada o vencida, congelada, cliente eliminado, pase de día anulado) |
| `RELOJ_DESFASADO` | El reloj del equipo estaba a más de 5 minutos del servidor |

**Hora de los ingresos.** Con hasta 5 minutos de desfase entre `estacion_ahora` y el servidor, se guarda `ocurrida_en`
tal cual. Con más, se le suma el desfase y queda por revisar. Una hora en el futuro sin `estacion_ahora` se reemplaza por
la de llegada y queda por revisar.

### E.5 Por revisar (solo el Jefe)
| Método y ruta | Entra | Sale |
|---|---|---|
| `GET /sync/revisiones?estado=&limit=&offset=` | `estado`: `pendiente_revision` (por defecto), `revisado`, `todas` | `{total, pendientes, items: [Revision]}` |
| `POST /sync/revisiones/{id}/revisar` | `{resolucion: "visto", nota}` (nota de 4 a 500 letras) | `Revision` |

`Revision = {id, entidad, entidad_id?, tipo_operacion, motivo_codigo, motivo, detalle, estacion_nombre,
registrado_por_nombre?, ocurrida_en, recibida_en, estado_revision, resoluciones_posibles, resolucion?,
revisado_por_nombre?, revisado_en?, nota_revision?}`.

Se revisa una sola vez y queda en auditoría (`REVISAR_SYNC`). `visto` no cambia el registro: solo deja constancia.
Aplica a lo que no mueve dinero (`entidad` en `checkins`, `staff`, `estaciones`). Las revisiones de la caja
(`turnos_caja`, `ventas`, `egresos_caja`) quedan pendientes hasta la fase 3B, que trae aplicar, ajustar y anular. Errores: `404 REVISION_NO_ENCONTRADA`, `409 REVISION_YA_REVISADA`, `409 RESOLUCION_NO_DISPONIBLE`.
