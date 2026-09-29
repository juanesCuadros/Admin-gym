# GymOS — Plan de pruebas contra requisitos consolidados (v2)

**v2 del 16-sep-2026.** La v1 (15-sep) se escribió sin los documentos de requisitos, sobre lo que
el código decía hacer. Esta versión cruza cada caso con `requisitos_consolidados_superadmin.md`,
`requisitos_consolidados_sistema-web.md` y `00_decisiones-consolidacion.md`. El detalle de qué
requisito está construido y cuál no vive en `MATRIZ_TRAZABILIDAD.md`; aquí solo se marca.

Alcance: v1 web. Huella, torniquete, modo sin internet y app móvil quedan fuera por decisión
(`00_decisiones §3`), no por olvido.

---

## Cómo usar esto

- Cada fila es un caso. Marca ✅ (pasó como se espera) o ❌ (algo raro) en **Resultado**, y escribe
  el detalle en **Notas** si falló: código de error exacto, captura, lo que sea.
- Los casos **🟢 feliz** confirman que el flujo normal funciona. Los **🔴 malo** confirman que el
  sistema *rechaza* lo que no debe pasar. Un ❌ en un caso 🔴 — o sea, **el sistema dejó pasar algo
  que debía bloquear** — es más grave que un ❌ en uno feliz: significa fuga, no falla.
- **⛔ delante del caso** = el requisito **no está construido** (ver la matriz). Ese caso va a dar ❌
  sí o sí; se deja en el plan para que la brecha quede contada, no para gastar tiempo probándolo.
  Cuando se implemente, se quita el ⛔ y se prueba.
- **⏸** = postergado por decisión. No se prueba en v1.
- Los bloques están por prioridad. Si no alcanza el tiempo, cubre **0, 2, 3 y 13.A** como mínimo.
- Donde aparece un código en `MAYÚSCULAS_CON_GUIONES` es el código de error literal que devuelve el
  backend. Si sale otro código, o un 500 genérico, es ❌ aunque la operación se haya bloqueado.
- La columna **RF** apunta al requisito y al criterio de aceptación (`SA-RF-16 CA2`). Un caso sin
  RF es una verificación técnica que el negocio no pidió pero que protege algo que sí pidió.

### Nombres de estado

Los requisitos consolidados renombraron tres estados del deportista (decisiones 9 y P-22). El
código todavía usa los nombres viejos. Este plan usa **el nombre consolidado** y entre paréntesis
el que devuelve hoy la API, para que nadie marque ❌ por un rename pendiente:

| Consolidado | Código hoy |
|---|---|
| `desactivado` | `inactivo` |
| `cancelado` | `cancelada` |
| `en_gracia` | `mora` (con `resultado_acceso = alerta_mora`) |

---

## Preparación

- [ ] Stack levantado: `cd infra && docker compose -f docker-compose.dev.yml up -d --build`, los 5
      contenedores en `healthy`.
- [ ] **Dos gimnasios**, no uno. El bloque 0 no se puede probar con un solo tenant. Crear el segundo
      desde el panel super admin (anotar la contraseña temporal que muestra: solo se ve una vez).
- [ ] Un usuario por rol en cada gimnasio: **jefe**, **recepcionista** (dos, para el bloque 3),
      **entrenador**.
- [ ] En el super admin, un usuario MVC (rol único, decisión 3).
- [ ] Al menos 2 planes (uno de 1 beneficiario y uno de 3, para 4.17+), 3 deportistas (uno menor de
      edad), 2 productos con stock, 1 clase con cupo limitado.
- [ ] Anotar los parámetros del tenant que se va a probar — las fronteras del bloque 2 dependen de
      ellos: `SELECT dias_gracia_mora, dias_umbral_por_vencer, tope_dias_congelamiento FROM platform.tenant;`
      (PowerGym hoy: gracia **3**, umbral **5**, tope congelamiento **30**).
- [ ] Entrar al sistema del gimnasio por `http://<subdominio>.localhost:3000`. **No usar el
      desplegable de "Sede"**: lista 4 gimnasios de demo que no existen en la base y cambiarlo
      rompe la sesión (ver bloque 12).
- [ ] Para los casos de fecha (13.A, 14.B, 4.C): poder mover `fecha_corte` / `fecha_vencimiento`
      directamente en base. No hay reloj simulado.

---

## Bloque 0 — Aislamiento entre gimnasios (🔴 el más importante de todos)

**RF:** SA-RNF-02, GW-RNF-02, GW-RF-00.5 CA4, GW-RF-28 CA1.

Esto no es "un módulo más": es el principio sobre el que se vende el SaaS. Un ❌ aquí es crítico y
bloquea el despliegue, no es un detalle a anotar.

| # | Tipo | Caso | RF | Pasos | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|---|
| 0.1 | 🔴 | Lectura cruzada por ID | GW-RF-00.5 CA4 | Con sesión del gym A, pedir `GET /api/v1/deportistas/{id}` con un ID real del gym B | 404 `DEPORTISTA_NO_ENCONTRADO`. **Nunca** el dato, y **nunca** 403 (403 confirma que existe) | | |
| 0.2 | 🔴 | Escritura cruzada | GW-RNF-02 | Con sesión de A, `PUT` sobre una membresía de B | 404, y en la base el registro de B **sin cambios** | | |
| 0.3 | 🔴 | Barrido de todos los módulos | GW-RNF-02 | Repetir 0.1 con un ID ajeno en: deportistas, membresías, planes, clases, ventas, turnos, productos, rutinas, staff | 404 en los 9. Anotar cuál falla | | |
| 0.4 | 🔴 | ⛔ **Puerta trasera de RLS** | SA/GW-RNF-02 | Ver nota abajo ⚠️ | Una conexión sin tenant configurado ve **0 filas** (fail-closed) | | |
| 0.5 | 🔴 | Auditoría aislada | GW-RF-49 | Jefe de B consulta auditoría | Jamás aparece un registro de A | | |
| 0.6 | 🔴 | Reportes aislados | GW-RF-41 | Exportar reporte en A y en B con los mismos filtros | Los totales no se solapan; ningún dato de A en el archivo de B | | |
| 0.7 | 🔴 | Token de otro tenant | GW-RF-00.1 CA2 | Usar el `access_token` de A contra el subdominio de B | 401/403, nunca 200 | | |
| 0.8 | 🟢 | Suspensión desde el panel | GW-RF-51 CA3 | Panel → suspender gym A; intentar cualquier operación en A | 403 `GIMNASIO_SUSPENDIDO`; el gym B **sigue operando normal** | | |
| 0.9 | 🔴 | Ejercicio propio invisible desde otro gimnasio | GW-RF-28 CA1 | Crear ejercicio propio en A; listar catálogo desde B | No aparece en B | | |

> ⚠️ **Caso 0.4.** `infra/db/01_schema.sql` líneas 1040, 1051, 1059 y 1063 incluyen
> `OR platform.current_gimnasio_id() IS NULL` en las políticas RLS. Traducido: **una sesión que no
> fije el tenant ve todas las filas de todos los gimnasios.** Los dos RNF-02 piden lo contrario
> (*fail-closed*). Para probarlo: conectarse como `gymos_platform` sin ejecutar el `SET` de tenant y
> hacer `SELECT count(*) FROM platform.deportistas`. Hoy devuelve filas de los dos gimnasios: ❌
> hasta que se quiten esos `OR`.

---

## Bloque 1 — Autenticación y sesión (GW-RF-00.1 a 00.5)

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 1.1 | 🟢 | Login correcto | GW-RF-00.1 | Entra; devuelve access + refresh | | |
| 1.2 | 🔴 | Contraseña incorrecta | GW-RF-00.2 CA1 | Error genérico, **no revela** si el correo existe | | |
| 1.3 | 🔴 | Correo de otro gimnasio | GW-RF-00.1 CA2 | Rechazado — el login lleva `subdominio` y debe filtrar por él | | |
| 1.4 | 🔴 | Staff desactivado | GW-RF-39 CA3 | 403 `STAFF_INACTIVO` (no un login válido con permisos vacíos) | | |
| 1.5 | 🔴 | 5 intentos fallidos | GW-RF-00.4 CA1 | Bloqueo 15 min. **El mensaje debe ser el genérico**; hoy devuelve `CUENTA_BLOQUEADA_TEMPORALMENTE`, que revela el bloqueo → anotar como ❌ menor | | |
| 1.6 | 🟢 | Refresh dentro de la ventana | GW-RF-00.1 | Renueva sin pedir login | | |
| 1.7 | 🔴 | Refresh inválido | GW-RF-00.1 | `REFRESH_TOKEN_INVALIDO` | | |
| 1.8 | 🟢 | Logout | GW-RF-00.3 CA1 | Sesión cerrada; el refresh anterior deja de servir | | |
| 1.9 | 🟢 | Recuperar contraseña | GW-RF-00.2 CA2 | Token de un solo uso; queda marcado en `tokens_recuperacion_staff`; vence en 1 h | | |
| 1.10 | 🔴 | Token de recuperación reusado | GW-RF-00.2 CA2 | `TOKEN_INVALIDO_O_EXPIRADO` | | |
| 1.11 | 🟢 | Matriz de permisos | GW-RF-00.5 | `GET /auth/permisos/matriz` refleja lo guardado en `platform.permisos_rol` | | |
| 1.12 | 🔴 | Recepcionista edita la matriz | GW-RF-00.5 CA3 | 403 `PERMISO_DENEGADO` — solo el jefe | | |
| 1.13 | 🔴 | ⛔ Refresh rota y detecta reuso | GW-RF-00.1 CA1 | Usar el refresh → obtener uno nuevo → volver a usar el viejo → **toda la familia revocada** (el nuevo tampoco sirve). Hoy el refresh no rota | | |
| 1.14 | 🔴 | ⛔ Primer ingreso con contraseña temporal | GW-RF-00.1 CA3 | Obliga a cambiarla antes de cualquier otra operación. Hoy no existe la bandera | | |
| 1.15 | 🔴 | Recepcionista entra sin turno abierto | GW-RF-00.1 CA4 | La UI la lleva a abrir caja antes de continuar; el Jefe y el Entrenador no | | |
| 1.16 | 🟢 | Cambio de contraseña cierra sesiones | GW-RF-00.2 CA3 | Tras restablecer, el refresh anterior devuelve 401 | | |
| 1.17 | 🔴 | Permiso quitado en caliente | GW-RF-00.5 CA1-2 | Jefe quita un permiso al recepcionista mientras está en el módulo → la siguiente petición da 403 y la UI lo saca con aviso | | |

---

## Bloque 2 — Control de ingreso y estado del deportista (🔴 el corazón del negocio)

**RF:** Módulo 00 (tabla de 8 estados), GW-RF-03, 04, 05, 06, 07, 27.

Toda la lógica vive en `MembresiaDomainService.evaluar_estado_puro()`
(`app/modules/membresias/domain.py:36-151`). **Si esto falla, falla el gimnasio entero.**

### 2.A Fronteras del estado (con gracia g = 3, umbral p = 5)

| # | Tipo | Situación del deportista | RF | Estado esperado | ¿Abre? | `resultado_acceso` | Resultado | Notas |
|---|---|---|---|---|---|---|---|---|
| 2.1 | 🟢 | Vence en 10 días | M00 #8 | `activo` | Sí | `abrio` | | |
| 2.2 | 🟢 | Vence en 6 días | M00 #8 | `activo` | Sí | `abrio` | | |
| 2.3 | 🟢 | **Vence en 5 días** (frontera p) | M00 #7 | `por_vencer` | Sí | `abrio` | | |
| 2.4 | 🟢 | Vence hoy | M00 #7 | `por_vencer` | Sí | `abrio` | | |
| 2.5 | 🟢 | Venció ayer | M00 CA1 | `en_gracia` (`mora`) | **Sí, con alerta** | `alerta_mora` | | |
| 2.6 | 🟢 | **Venció hace 3 días** (frontera g) | M00 #6 | `en_gracia` (`mora`) | Sí, con alerta | `alerta_mora` | | |
| 2.7 | 🔴 | **Venció hace 4 días** (frontera g+1) | M00 CA2 | `vencido` | **No** | `negado` | | |
| 2.8 | 🔴 | Sin membresía nunca | M00 #3 | `sin_membresia` | No | `negado` | | |
| 2.9 | 🔴 | Membresía cancelada | M00 #2 | `cancelado` (`cancelada`) | No | `negado` | | |
| 2.10 | 🔴 | Membresía congelada | M00 #4 | `congelado` | No | `negado` | | |
| 2.11 | 🔴 | Deportista desactivado | M00 #1 | `desactivado` (`inactivo`) | No | `negado` | | |
| 2.24 | 🔴 | **Gracia = 0** y venció ayer | M00 CA3 | `vencido` — con g=0 no hay gracia | No | `negado` | | |

### 2.B Precedencia de reglas (el orden importa)

El dominio evalúa en cascada y **la primera condición que aplica gana**. Estos casos existen porque
un error de orden es invisible en las pruebas de 2.A.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 2.12 | 🔴 | Deportista **desactivado** pero con membresía vigente | M00 #1 | `desactivado` / negado — la desactivación manda sobre todo | | |
| 2.13 | 🔴 | Membresía **congelada** y además vigente | M00 #4 | `congelado` / negado — el congelamiento manda sobre la fecha | | |
| 2.14 | 🔴 | Membresía **congelada y vencida** | M00 CA4 | `congelado` / negado (no `vencido`) | | |
| 2.15 | 🔴 | Deportista desactivado **y** congelado | M00 #1 | `desactivado` / negado | | |

### 2.C Operación del control de ingreso

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 2.16 | 🟢 | Check-in manual por documento o nombre | GW-RF-03 CA1-2 | Abre; queda fila en `platform.checkins` con el `resultado` correcto | | |
| 2.17 | ⏸ | Check-in por huella | GW-RF-01/02 | Postergado a fase escritorio. No se prueba | — | — |
| 2.18 | 🔴 | Documento inexistente | GW-RF-03 | `DEPORTISTA_NO_ENCONTRADO`, sin fila de check-in | | |
| 2.19 | 🟢 | Ingreso de cortesía | GW-RF-05 CA1 | Exige motivo; queda auditado; **no crea check-in de deportista ni cuenta como asistencia** | | |
| 2.20 | 🔴 | Cortesía por recepcionista sin permiso | GW-RF-05 | 403 `PERMISO_DENEGADO` | | |
| 2.21 | 🟢 | Ingresos de hoy | GW-RF-06, GW-RNF-07 | Lista solo los de hoy **en zona horaria del gimnasio** (`America/Bogota`), no UTC | | |
| 2.22 | 🔴 | Check-in con el gimnasio suspendido | GW-RF-51 CA3 | 403 `GIMNASIO_SUSPENDIDO` | | |
| 2.23 | 🔴 | Pantalla TV nunca muestra denegados | GW-RF-07 CA1 | Tras un `negado` la TV **no cambia**; tras un `abrio` muestra "Bienvenido, {primer nombre}" | | |
| 2.25 | 🟢 | Check-in en gracia muestra días vencidos | GW-RF-03 CA3 | Recepción ve la alerta con el número de días | | |

> **Ojo con 2.21.** El corte del día en `America/Bogota` es UTC-5: un ingreso a las 20:00 hora local
> es 01:00 UTC del día siguiente. Probar un check-in después de las 19:00 hora local y confirmar que
> aparece en el día correcto. Este error solo se ve de noche, y por eso se escapa.

---

## Bloque 3 — Caja y turnos (💰 el dinero)

**RF:** GW-RF-08 a 16, GW-RF-53, P-11, P-13.

### 3.A Turnos

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 3.1 | 🟢 | Abrir turno con base inicial | GW-RF-08 CA3 | Turno abierto; queda el monto base (opcional, ≥ 0) | | |
| 3.2 | 🔴 | Abrir turno con uno propio ya abierto | GW-RF-08 | `TURNO_YA_ABIERTO` | | |
| 3.17 | 🔴 | ⛔ **Un solo turno abierto por gimnasio** | GW-RF-08 CA1, P-13 | Recepcionista 1 abre; recepcionista 2 intenta abrir → rechazado. Hoy el UNIQUE es por staff (`ux_turno_abierto_por_staff`): **deja abrir dos** | | |
| 3.18 | 🟢 | ⛔ Cerrar el turno ajeno | GW-RF-08 CA2 | Recepcionista 2 cierra el turno de la 1 antes de abrir el suyo; el descuadre queda atribuido a la 1. Hoy solo existe el cierre forzado del Jefe | | |
| 3.12 | 🟢 | Cerrar turno cuadrado | GW-RF-10 CA1 | Cierra; efectivo esperado = base + ingresos en efectivo − egresos − reversos en efectivo; los demás medios aparte | | |
| 3.13 | 🟢 | Cerrar turno descuadrado | GW-RF-10 CA2 | Cierra registrando conteo y diferencia; **queda marcado para revisión del Jefe** y él puede dejar nota | | |
| 3.14 | 🔴 | Cerrar turno ya cerrado | GW-RF-10 CA3 | `TURNO_YA_CERRADO` | | |
| 3.19 | 🔴 | Reabrir turno cerrado | GW-RF-10 CA3, P-11 | No existe ninguna vía (ni endpoint ni UI). Si la hay, ❌ | | |
| 3.15 | 🟢 | Cierre forzado por el Jefe | — | Cierra un turno ajeno; queda auditado con actor y motivo. **Es el comportamiento actual, no el requerido** (ver 3.18) | | |
| 3.16 | 🔴 | Cierre forzado por recepcionista | — | 403 `PERMISO_DENEGADO` | | |
| 3.22 | 🟢 | Movimientos del turno | GW-RF-13 | Lista ventas, pagos, egresos y reversos, cada uno con usuario y hora | | |
| 3.27 | 🟢 | Turno no se cierra a medianoche | GW-RF-10 CA4 | Un turno abierto a las 23:50 sigue abierto a las 00:10; los reportes usan la fecha de cada movimiento | | |

### 3.B Ventas y pagos

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 3.3 | 🔴 | Vender sin turno abierto | GW-RF-09 CA1 | 409 `NO_HAY_TURNO_ABIERTO` **desde la API**, no solo la UI | | |
| 3.4 | 🟢 | Venta de productos | GW-RF-11 CA1, GW-RF-38 | Descuenta stock; queda en `ventas` + `venta_items` + `stock_movimientos` | | |
| 3.5 | 🔴 | Venta sin stock suficiente | GW-RF-38 CA1 | `STOCK_INSUFICIENTE`; **el stock no se mueve** | | |
| 3.20 | 🔴 | Doble envío de la misma venta | GW-RF-11 CA2 | Misma `X-Idempotency-Key` → una sola venta | | |
| 3.6 | 🔴 | Pago menor al total | GW-RF-15 CA3 | `PAGO_INSUFICIENTE` — no hay abonos | | |
| 3.28 | 🟢 | Pago mayor al total | GW-RF-15 CA2 | Muestra el cambio; registra como monto el precio final, **sin saldo a favor** | | |
| 3.7 | 🟢 | Anular venta | GW-RF-12 CA1 | Exige permiso y motivo; devuelve el stock; la venta queda marcada, **no borrada** | | |
| 3.8 | 🔴 | Anular venta ya anulada | GW-RF-12 CA1 | `VENTA_YA_ANULADA` | | |
| 3.21 | 🟢 | Anular venta de un turno cerrado | GW-RF-12 CA2 | El reverso se registra en el **turno abierto actual** (`devoluciones.turno_devolucion_id`), no en el original | | |
| 3.9 | 🟢 | Pago de membresía | GW-RF-15 | Extiende el vencimiento; el deportista pasa a `activo` | | |
| 3.10 | 🔴 | Anular pago de membresía | GW-RF-16 CA1-3 | La fecha de vencimiento **vuelve atrás**; el estado se recalcula; los check-ins ya ocurridos se conservan; el reverso va al turno actual | | |
| 3.11 | 🟢 | Egreso de caja con motivo | GW-RF-14 | Resta del esperado en el cierre; puede dejar la caja en negativo sin bloquearla | | |

> **Caso 3.10 es el que más duele si falla.** Anular un pago tiene que revertir el vencimiento, no
> solo marcar el pago. Probar: pagar → confirmar que abre → anular → confirmar que **deja de
> abrir**. Si sigue abriendo, hay dinero devuelto con acceso regalado. Nota: hoy el código resta
> `dias_agregados` en vez de recalcular del historial; si hubo un congelamiento entre el pago y la
> anulación, comparar el resultado con lo que daría el historial.

### 3.C Descuentos (GW-RF-53, P-18)

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 3.23 | 🟢 | ⛔ Descuento con permiso y parámetro activo | GW-RF-53 CA1, CA3 | Exige motivo; la venta guarda precio de lista y precio cobrado; queda en auditoría | | |
| 3.24 | 🔴 | ⛔ Descuento sin el permiso | GW-RF-53 CA1 | 403 `PERMISO_DENEGADO` | | |
| 3.25 | 🔴 | ⛔ Descuento mayor al tope | GW-RF-53 CA2 | 422 | | |
| 3.26 | 🔴 | ⛔ Descuento con "permitir descuentos" = No | GW-RF-53 CA1 | Rechazado aunque el usuario tenga el permiso | | |

---

## Bloque 4 — Membresías, planes y paquetes

**RF:** GW-RF-24, 25, 26, 27, 52. Decisiones P-10 (C2), P-14, P-20, P-26.

### 4.A Planes

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 4.1 | 🟢 | Crear plan | GW-RF-24 CA1 | Con nombre, precio, duración y número de beneficiarios; queda activo | | |
| 4.2 | 🔴 | Plan con nombre repetido | GW-RF-24 | `PLAN_YA_EXISTE` | | |
| 4.3 | 🔴 | Asignar plan inactivo | GW-RF-24 CA3 | `PLAN_INACTIVO`; las membresías vigentes de ese plan **siguen** funcionando | | |
| 4.15 | 🔴 | ⛔ Editar plan tras vender | GW-RF-24 CA2 | La membresía vendida conserva precio y duración originales. Hoy `membresias` no guarda copia | | |

### 4.B Ciclo de vida

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 4.4 | 🟢 | Asignar membresía | GW-RF-25 | Calcula el vencimiento según la duración del plan | | |
| 4.5 | 🟢 | Cambiar de plan | GW-RF-25 CA3, P-20 | El plan nuevo **empieza cuando termina el actual**; sin prorrateo; se audita como `CAMBIO_DE_PLAN` | | |
| 4.10 | 🔴 | Operar sobre membresía cancelada | GW-RF-25 | `MEMBRESIA_CANCELADA` | | |
| 4.11 | 🔴 | Cancelar una ya cancelada | GW-RF-25 CA4 | `YA_CANCELADA` | | |
| 4.25 | 🔴 | Cancelar sin permiso o sin motivo | GW-RF-25 CA4 | Rechazado; la cancelación es inmediata y sin reembolso solo con ambos | | |

### 4.C Renovación y regla C2 (con g = 3)

Es la regla más fácil de probar mal: exige mover fechas en base y crear check-ins con fecha pasada.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 4.26 | 🟢 | Renovar vigente | GW-RF-25 CA1 | Suma desde el vencimiento, sin perder días | | |
| 4.12 | 🟢 | ⛔ Entró en gracia (venc+1) y renueva el venc+6 | GW-RF-25 CA2 | El nuevo periodo cuenta desde `venc`. Hoy cuenta desde hoy | | |
| 4.13 | 🟢 | ⛔ No entró en gracia y renueva el venc+3 | GW-RF-25 CA2 | Cuenta desde venc+3 (hoy) | | |
| 4.14 | 🟢 | ⛔ No entró en gracia y renueva el venc+10 | GW-RF-25 CA2 | Cuenta desde venc+10 (hoy) | | |

### 4.D Congelamiento

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 4.6 | 🟢 | Congelar | GW-RF-26 CA2 | Estado `congelado`; el ingreso niega (ver 2.10); registra inicio y fin | | |
| 4.7 | 🔴 | Congelar una ya congelada | GW-RF-26 | `MEMBRESIA_YA_CONGELADA` | | |
| 4.27 | 🔴 | Congelar una `en_gracia` o `vencido` | GW-RF-26 CA1, P-26 | Rechazado: solo `activo` o `por_vencer` | | |
| 4.8 | 🔴 | Superar el tope acumulado | GW-RF-26 CA3 | `TOPE_CONGELAMIENTO_ALCANZADO` (tope del tenant: 30 días) | | |
| 4.16 | 🔴 | ⛔ Congelar por debajo del mínimo | GW-RF-26 CA3 | Rechazado. Hoy no existe el parámetro mínimo | | |
| 4.9 | 🟢 | Descongelar antes de la fecha | GW-RF-26 CA4 | **El vencimiento se corre solo por los días efectivos**; vuelve a abrir | | |

> **Caso 4.9.** Si descongelar no corre la fecha, el gimnasio le está cobrando al cliente los días
> que no usó. Verificar el vencimiento en base antes y después, y que la diferencia sea exactamente
> los días efectivamente congelados.

### 4.E Planes grupales — paquetes (GW-RF-52, P-14) — ⛔ todo el sub-bloque

Nada de esto existe en el código (cero ocurrencias de "paquete"). Se deja completo para que el
alcance quede contado.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 4.17 | 🟢 | ⛔ Vender plan de 3 con 3 beneficiarios | GW-RF-52 | Crea 3 membresías individuales ligadas al mismo paquete; el precio se divide en enteros y el sobrante va a la primera | | |
| 4.18 | 🔴 | ⛔ Vender con N−1 beneficiarios | GW-RF-52 CA1 | 422 | | |
| 4.19 | 🔴 | ⛔ Titular menor de edad | GW-RF-52 CA2 | Rechazado | | |
| 4.20 | 🔴 | ⛔ Falla una de las N | GW-RF-52 CA3 | No se crea ninguna (atómico) | | |
| 4.21 | 🔴 | ⛔ Misma persona agregada dos veces a la vez | GW-RF-52 CA4 | La restricción en BD rechaza el segundo | | |
| 4.22 | 🟢 | ⛔ Beneficiario con membresía vigente | GW-RF-52 | Su membresía del paquete empieza cuando vence la actual | | |
| 4.23 | 🟢 | ⛔ Anular el pago del paquete | GW-RF-52 | Revierte las N membresías en una sola operación | | |
| 4.24 | 🔴 | ⛔ Cambiar un beneficiario | GW-RF-52 | No existe la operación | | |
| 4.28 | 🟢 | ⛔ Congelar a uno del paquete | GW-RF-52 | Afecta solo a esa persona | | |

---

## Bloque 5 — Deportistas y Ley 1581

**RF:** GW-RF-17, 19, 20, 21, 23. Decisión P-15.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 5.1 | 🟢 | Crear deportista | GW-RF-17 | Queda activo | | |
| 5.2 | 🔴 | Documento repetido en el mismo gimnasio | GW-RF-17 CA1 | `DOCUMENTO_YA_REGISTRADO` | | |
| 5.3 | 🟢 | **Mismo documento en otro gimnasio** | GW-RF-17 CA1 | **Permitido** — la unicidad es por tenant, no global | | |
| 5.4 | 🟢 | Correo repetido | GW-RF-17 CA2 | **Permitido** según el requisito consolidado. Si la API devuelve `CORREO_DUPLICADO`, anotar: el código contradice el requisito | | |
| 5.5 | ⏸ | Registrar huella | GW-RF-22 | Postergado | — | — |
| 5.6 | ⏸ | Borrar huella | GW-RF-22 | Postergado | — | — |
| 5.7 | 🟢 | Ficha y mediciones | GW-RF-20, 21 | Muestra estado calculado, membresías, pagos (anulados marcados), accesos, rutinas; mediciones por fecha | | |
| 5.8 | 🟢 | **Supresión de datos (Ley 1581)** | GW-RF-23 CA1-2 | `SUPRESION_DATOS_LEY_1581`: borra datos personales, anonimiza, **conserva** los pagos con referencia anónima; exige confirmación; la auditoría no guarda datos personales | | |
| 5.9 | 🔴 | Check-in tras la supresión | GW-RF-23 | El deportista ya no resuelve por documento | | |
| 5.10 | ⏸ | Invitación a la app | GW-RF-18 | Postergado | — | — |
| 5.11 | 🟢 | Visitante con pase de día | GW-RF-17 CA3, P-15 | Registro mínimo (nombre, documento, consentimiento) + venta de `pase_dia` en caja; entra ese día | | |
| 5.12 | 🔴 | Menor de edad sin acudiente | GW-RF-17 CA4 | Rechazado; con acudiente **y autorización** se acepta. Hoy solo pide `acudiente_nombre` | | |
| 5.13 | 🔴 | Inscripción sin consentimiento | GW-RF-19 CA1-2 | No se completa. Con consentimiento guarda fecha, **versión del texto** y quién lo registró (hoy solo fecha) | | |
| 5.14 | 🟢 | Desactivar con membresía vigente | GW-RF-17 CA5 | La UI advierte; si confirma, el estado pasa a `desactivado` | | |

> **Caso 5.8 es una obligación legal colombiana, no una función más.** Hay que verificar en base qué
> quedó: los datos personales deben desaparecer, pero las ventas y pagos asociados tienen que seguir
> existiendo para la contabilidad. Si borra de más, se pierde la contabilidad; si borra de menos, se
> incumple la ley.

---

## Bloque 6 — Clases y reservas

**RF:** GW-RF-32, 33, 34. Decisiones P-17, P-21.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 6.1 | 🟢 | Crear clase con cupo | GW-RF-32 | Queda programada; profesor = entrenador del sistema o externo | | |
| 6.2 | 🟢 | Clase recurrente | GW-RF-32 CA1 | Genera las ocurrencias esperadas, sin huecos ni duplicados | | |
| 6.15 | 🟢 | Recurrente omitiendo festivos | GW-RF-32 CA1 | Con `omitir_festivos` no genera ocurrencia el 20-jul ni el 7-ago | | |
| 6.16 | 🔴 | Reducir el cupo por debajo de las reservas | GW-RF-32 CA3 | `CUPO_MENOR_A_RESERVAS` | | |
| 6.18 | 🟢 | Editar "solo esta" vs "toda la serie" | GW-RF-32 CA2 | Solo esta: cambia una ocurrencia. Serie: cambia todas las futuras | | |
| 6.3 | 🟢 | Reservar con membresía activa | GW-RF-33 CA1 | Reserva confirmada, sin pase | | |
| 6.4 | 🔴 | Reservar con membresía vencida o en gracia | GW-RF-33 CA1 | Rechazado: debe comprar pase de clase en Caja | | |
| 6.13 | 🔴 | Reservar clase posterior al vencimiento | GW-RF-33 CA2, P-17 | Rechazado aunque hoy esté `activo` | | |
| 6.14 | 🔴 | ⛔ Fuera de la ventana de reserva / cancelar tarde | GW-RF-33 CA3 | Rechazado según los parámetros del gimnasio. Hoy no existen los parámetros | | |
| 6.5 | 🔴 | Reservar dos veces | GW-RF-33 CA5 | `RESERVA_YA_EXISTE` | | |
| 6.6 | 🔴 | **Reservar con cupo lleno** | GW-RF-33 CA4 | `CUPO_AGOTADO`. Probar **dos reservas simultáneas** para el último cupo: solo una entra | | |
| 6.7 | 🟢 | Cancelar reserva | GW-RF-33 | Libera el cupo; otro puede tomarlo | | |
| 6.8 | 🔴 | Reservar en clase cancelada | GW-RF-32 | `CLASE_NO_DISPONIBLE` | | |
| 6.17 | 🟢 | Cancelar clase con pases pagados | GW-RF-32 CA5, P-21 | Cancela sus reservas; recepción anula la venta del pase con la regla de GW-RF-12 | | |
| 6.9 | 🟢 | Registrar asistencia | GW-RF-34 | Queda en `asistencia_clase` | | |
| 6.10 | 🔴 | Asistencia sin check-in **ese mismo día** | GW-RF-34 CA1 | `SIN_CHECKIN_PREVIO` | | |
| 6.19 | 🟢 | Inasistencia | GW-RF-34 CA2 | No penaliza ni libera el cupo | | |
| 6.11 | 🟢 | Cerrar clase | — | No admite más cambios | | |
| 6.12 | 🟢 | Calificar clase y entrenador | — | Una calificación por deportista | | |

> **Caso 6.6 es una condición de carrera, no una validación.** Probarlo en serie siempre pasa. Hay
> que lanzar las dos reservas a la vez (dos pestañas, o `curl` en paralelo) y confirmar que el cupo
> no se sobrevende. El código usa `FOR UPDATE` sobre la clase; esto verifica que funciona.

---

## Bloque 7 — Entrenamiento y rutinas

**RF:** GW-RF-28, 29, 30, 31.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 7.1 | 🟢 | Catálogo híbrido | GW-RF-28 CA1 | El entrenador ve los ejercicios globales **y** los del gimnasio | | |
| 7.2 | 🟢 | Ejercicio propio del gimnasio | GW-RF-28 CA1 | Visible solo en ese tenant (ver 0.9) | | |
| 7.3 | 🔴 | Ejercicio desactivado en plantilla nueva | GW-RF-29 CA2 | `EJERCICIO_NO_DISPONIBLE` al agregarlo | | |
| 7.9 | 🟢 | Ejercicio desactivado en plantilla existente | GW-RF-28 CA2 | Sigue apareciendo, **sin imagen** | | |
| 7.10 | 🟢 | Nombre en español o inglés | GW-RF-28 CA3 | Si hay `nombre_es` lo muestra; si no, el inglés | | |
| 7.4 | 🟢 | Crear plantilla de rutina | GW-RF-29 | Queda reutilizable | | |
| 7.5 | 🔴 | Plantilla sin ejercicios | GW-RF-29 | `RUTINA_SIN_ITEMS` | | |
| 7.11 | 🟢 | Eliminar plantilla asignada | GW-RF-29 CA1 | Las rutinas ya asignadas no cambian | | |
| 7.6 | 🟢 | Asignar rutina | GW-RF-30 CA1 | **Snapshot inmutable**: cambiar la plantilla después NO altera la rutina ya asignada | | |
| 7.7 | 🟢 | Varias rutinas por deportista | GW-RF-30 CA2 | Se permiten | | |
| 7.8 | 🔴 | Entrenador toca rutina de otro entrenador | GW-RF-00.5 | Según la matriz de permisos; anotar qué hace hoy | | |

---

## Bloque 8 — Inventario y stock

**RF:** GW-RF-36, 37, 38.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 8.1 | 🟢 | Crear producto con stock | GW-RF-36 | Queda disponible en caja | | |
| 8.2 | 🔴 | Producto repetido | GW-RF-36 | `PRODUCTO_YA_EXISTE` | | |
| 8.3 | 🟢 | Entrada de stock | GW-RF-37 CA1 | Suma; queda en `stock_movimientos` | | |
| 8.8 | 🟢 | Ajuste con motivo y permiso | GW-RF-37 CA1 | Suma o resta; queda auditado | | |
| 8.5 | 🔴 | Ajuste que deja negativo | GW-RF-37 CA2 | Rechazado | | |
| 8.4 | 🟢 | Salida por venta | GW-RF-38 | Resta (ver 3.4); la venta guarda el precio del momento | | |
| 8.9 | 🔴 | Vender producto inactivo | GW-RF-38 CA1 | Bloqueada | | |
| 8.6 | 🟢 | Cuadre | — | Suma de movimientos = stock actual, sin desfase | | |
| 8.7 | 🔴 | **Dos ventas simultáneas del último ítem** | GW-RF-38 CA2 | Solo una prospera; el stock no queda negativo | | |

---

## Bloque 9 — Personal y staff

**RF:** GW-RF-39, 40. Decisión 10.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 9.1 | 🟢 | Crear staff con rol | GW-RF-39 CA1 | Puede entrar con su rol | | |
| 9.10 | 🔴 | ⛔ Credencial temporal de 72 h | GW-RF-39 CA1 | Se muestra una sola vez; exige cambio en el primer ingreso; a las 72 h deja de servir. Hoy el Jefe escribe la contraseña definitiva | | |
| 9.2 | 🔴 | Correo repetido en el gimnasio | GW-RF-39 CA2 | `CORREO_DUPLICADO` | | |
| 9.3 | 🔴 | Rol inexistente | GW-RF-39 | `ROL_INVALIDO` | | |
| 9.4 | 🔴 | **Auto-modificación** | — | `AUTO_MODIFICACION_NO_PERMITIDA` — nadie cambia su propio rol ni se desactiva | | |
| 9.5 | 🔴 | Operar sobre el jefe | GW-RF-00.5 CA3 | `OPERACION_INVALIDA_SOBRE_JEFE` | | |
| 9.11 | 🟢 | Desactivar cierra sesiones | GW-RF-39 CA3 | El refresh del desactivado devuelve 401 de inmediato | | |
| 9.6 | 🟢 | Transferir la jefatura | GW-RF-40 CA1 | El anterior pasa al rol elegido; **siempre queda exactamente un jefe** | | |
| 9.7 | 🔴 | Transferir a staff inactivo | GW-RF-40 CA1 | `STAFF_INACTIVO` | | |
| 9.8 | 🔴 | Transferir a alguien que ya es jefe | GW-RF-40 | `TRANSFERENCIA_ROL_JEFE` | | |
| 9.9 | 🟢 | Desactivar recepcionista con turno abierto | GW-RF-39 CA4 | **No** cierra el turno; lo cierra la siguiente recepcionista (3.18) | | |

> **Caso 9.6 es un invariante, no un flujo.** Después de cada transferencia:
> `SELECT count(*) FROM platform.staff WHERE rol='jefe' AND gimnasio_id=...` debe dar **1**. Ni 0
> ni 2. GW-RF-40 CA2 pide que lo garantice un constraint en BD; no se ve ninguno en
> `01_schema.sql` — si la API lo garantiza solo por código, anotar.

---

## Bloque 10 — Reportes

**RF:** GW-RF-41, 42, 43, 44.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 10.1 | 🟢 | Reporte de ingresos | GW-RF-41 CA1 | Cuadra con ventas + pagos − egresos del periodo; los anulados se excluyen del total pero se pueden ver | | |
| 10.9 | 🟢 | ⛔ Precio de lista vs cobrado | GW-RF-41 CA2 | Muestra ambos por venta. Depende de 3.C | | |
| 10.2 | 🟢 | Exportar CSV y Excel | GW-RF-44 | Se descarga y abre; **CSV con BOM UTF-8** (abrirlo en Excel y ver tildes bien); exporta exactamente lo filtrado | | |
| 10.3 | 🔴 | Rango de fechas invertido | — | `RANGO_FECHAS_INVALIDO` | | |
| 10.4 | 🔴 | Tipo de reporte inexistente | — | `TIPO_REPORTE_INVALIDO` | | |
| 10.5 | 🔴 | Reporte con datos del otro gimnasio | GW-RNF-02 | Ver 0.6 — ningún dato cruzado | | |
| 10.6 | 🟢 | Afluencia por horario y "sin asistencia N días" | GW-RF-43 | Coincide con los check-ins reales; "sin asistencia" es métrica, no estado | | |
| 10.7 | 🟢 | Periodo sin datos | — | Reporte vacío bien formado, **no un 500** | | |
| 10.8 | 🟢 | Lista de "por vencer" con contacto | GW-RF-42 | Usa el umbral del gimnasio; muestra teléfono/correo de cada uno | | |

---

## Bloque 11 — MyGymOS: configuración y auditoría

**RF:** GW-RF-45 a 50. Decisión F (parámetros).

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 11.1 | 🟢 | Editar datos y contacto | GW-RF-45 | Persiste; queda auditado | | |
| 11.9 | 🟢 | Desactivar un método de pago | GW-RF-47 CA1 | Deja de ofrecerse; los pagos anteriores no cambian | | |
| 11.2 | 🟢 | Cambiar `dias_gracia_mora` | GW-RF-48 CA2 | **Efecto en la siguiente evaluación**: cambiar a 1 y repetir el caso 2.6 → ahora `vencido` | | |
| 11.3 | 🔴 | Valores fuera de rango | GW-RF-48 CA1 | 422, sin guardar | | |
| 11.10 | 🟢 | ⛔ Los 6 parámetros faltantes | GW-RF-48 | Mínimo congelamiento, permitir descuentos, tope %, duración de sesión (15 min–8 h), ventana de reserva, límite para cancelar. Hoy solo existen 3 de 9 | | |
| 11.4 | 🔴 | **Colisión de versiones (OCC)** | — | Dos ediciones con la misma `version` → la segunda da 409 `CONFLICTO_CONCURRENCIA` | | |
| 11.5 | 🟢 | Landing y QR | GW-RF-46 | Devuelve SVG y descarga PNG válidos; el enlace público resuelve | | |
| 11.6 | 🟢 | Auditoría con filtros | GW-RF-50 | Filtra por fecha, actor, entidad, acción; pagina de a 20 | | |
| 11.7 | 🔴 | Auditoría por no-jefe | GW-RF-49 CA2 | 403 para recepcionista y entrenador | | |
| 11.8 | 🔴 | **Auditoría inmutable en base** | GW-RF-49 CA1 | `UPDATE`/`DELETE` sobre `platform.auditoria_gym` lanza `auditoria_gym es append-only` (trigger `tg_audgym_no_update`, `01_schema.sql:832-836`) | | |
| 11.11 | 🔴 | Cadena de hash del gimnasio | GW-RF-49 CA1 | Alterar `hash_actual` de una fila (con el trigger deshabilitado a propósito) → la verificación lo detecta | | |
| 11.12 | 🔴 | Secretos en auditoría | GW-RF-49 CA1 | `SELECT * FROM platform.auditoria_gym WHERE detalle::text ILIKE '%password%' OR detalle::text ILIKE '%token%'` → 0 filas con valores en claro | | |

> **Corrección respecto a la v1.** El plan anterior decía que la auditoría no era inmutable en base.
> Es falso: los triggers append-only existen en las dos tablas. El caso 11.8 se espera 🟢.

---

## Bloque 12 — Frontend del gimnasio

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 12.1 | 🟢 | Entrar por `<subdominio>.localhost:3000` | GW-RF-00.1 CA2 | Resuelve el tenant correcto y aplica su branding | | |
| 12.2 | 🟢 | Entrar por `?subdominio=<sub>` | — | Igual que 12.1 | | |
| 12.3 | 🔴 | **Desplegable de "Sede"** | — | Ver nota ⚠️ | | |
| 12.4 | 🟢 | Pantalla TV en el monitor de recepción | GW-RF-07 CA2-4 | Muestra hora, logos, clases del día, avisos; reconecta sola con espera creciente al cortar la red; sin emparejar dispositivo | | |
| 12.5 | 🔴 | Pantallas sin cablear | — | Verificar que Inventario, Reportes y Personal ya usan backend real (los 4 módulos se implementaron después de `ORGANIZACION-REPO.md:§8`) | | |
| 12.6 | 🔴 | Sesión expirada en pantalla | GW-RF-00.3 | Redirige a login conservando la ruta, no deja la pantalla en blanco ni en bucle | | |
| 12.7 | 🟢 | Formatos de Colombia | GW-RNF-06 | Fechas `dd/mm/aaaa`, moneda `$ 1.234.567`, tablas de 20 filas, éxito flotante y error fijo | | |

> ⚠️ **Caso 12.3.** El `<select>` de "Sede" en `LoginPage.tsx:101-140` se llena desde
> `TENANT_PRESETS` (`TenantThemeContext.tsx:5-42`): cuatro gimnasios de demo hardcodeados que **no
> existen en la base**. Cambiarlo llama `applyPreset()` y sobrescribe el tenant activo. Es lo primero
> que ve el usuario en el login, así que la trampa es activa.

---

## Bloque 13 — Super-Admin: ciclo de vida del gimnasio

**RF:** SA-RF-00.x, 01 a 12, 29, 30, 31, 32. Reglas §2 y §2.4.

### 13.A Estados calculados y bloqueo automático (§2.2, SA-RF-32) — ⛔ todo el sub-bloque

Nada calcula el estado desde `fecha_corte`. Es la brecha #1 de la matriz. Los casos se prueban
moviendo `superadmin.gimnasios.fecha_corte` en base y consultando la ficha y el producto.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 13.12 | 🟢 | ⛔ Corte en 6 días / en 5 días | §2.2 | d = −6 → `al_dia`; d = −5 → `por_vencer` (frontera) | | |
| 13.13 | 🟢 | ⛔ Corte hoy / ayer / hace 3 días | §2.2 | d = 0 → `por_vencer`; d = 1 y d = 3 → `en_gracia`; el GW funciona con aviso | | |
| 13.14 | 🔴 | ⛔ Corte hace 4 días | §2.2, §2.3 | `bloqueado`; el GW responde 403 a todo; la landing dice "no disponible" | | |
| 13.15 | 🔴 | ⛔ Prueba vencida ayer | §2.2 | `bloqueado` de inmediato (sin gracia para pruebas) | | |
| 13.16 | 🟢 | ⛔ Pago levanta el bloqueo | SA-RF-32 CA extra | Registrar pago que deje d < 4 → la siguiente petición del GW ya pasa, sin reiniciar nada | | |
| 13.18 | 🟢 | ⛔ `prueba_por_vencer` en el panel | §2.2 | Prueba con 0 ≤ corte − hoy ≤ 2 aparece en la métrica | | |

### 13.B Inicio y listado

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 13.1 | 🟢 | Tablero de inicio | SA-RF-01 | Gimnasios por estado guardado y calculado; ingresos del mes = Σ pagos no anulados con `fecha_pago` en el mes (Bogotá); anular un pago los descuenta | | |
| 13.2 | 🟢 | Tabla de urgencia | SA-RF-02 | Orden: bloqueados → en gracia → pruebas por vencer → por vencer → resto; los cancelados no aparecen | | |
| 13.27 | 🟢 | Búsqueda sin tildes ni mayúsculas | SA-RF-03 CA1 | "nandu" encuentra "Ñandú"; pagina de a 20; filtra por estado guardado y calculado | | |
| 13.10 | 🔴 | Usuario del tenant no entra al SA | SA-RNF-01 | Login con credenciales de un jefe de gimnasio → rechazado (rol único MVC, decisión 3) | | |

### 13.C Alta y subdominio

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 13.3 | 🟢 | Crear gimnasio | SA-RF-04, 06, 15 | 201; **muestra la contraseña temporal del jefe**; crea tenant, jefe, métodos de pago por defecto (efectivo, tarjeta, transferencia) y parámetros iniciales en una transacción; prueba = 5 días | | |
| 13.28 | 🔴 | ⛔ Doble clic / reintento en "Crear" | SA-RF-04 CA2-3 | Misma `Idempotency-Key` → un solo gimnasio. Hoy el alta no acepta la clave | | |
| 13.41 | 🟢 | Provisioning retoma desde el paso fallido | SA-RF-06 CA4 | Forzar fallo en un paso → reintento no duplica lo ya creado (`provisioning_pasos`) | | |
| 13.4 | 🟢 | Subdominio autogenerado | SA-RF-05 CA1 | `Gimnasio Ñandú` → `gimnasio-nandu` | | |
| 13.29 | 🔴 | ⛔ Subdominio reservado | SA-RF-05 CA3 | `admin`, `www`, `api`, `app`, `mail` → rechazado. Hoy no hay lista de reservados | | |
| 13.30 | 🔴 | Subdominio de 63 caracteres | SA-RF-05 CA2 | Aceptado (límite DNS). Hoy la regex corta en 50 → anotar | | |
| 13.31 | 🔴 | Dos altas simultáneas con el mismo subdominio | SA-RF-05 CA4 | La segunda recibe 409 (UNIQUE en BD) | | |
| 13.5 | 🔴 | **Subdominio inmutable** | SA-RF-08 CA1 | Enviar `subdominio` en el `PUT` → 422 | | |
| 13.32 | 🔴 | Edición concurrente | SA-RF-08 CA2 | Dos `PUT` con la misma `version` → el segundo da 409; la auditoría guarda antes y después | | |
| 13.6 | 🟢 | Ficha del gimnasio | SA-RF-07 | Datos, estado guardado y calculado, días restantes, suscripción, cuenta del jefe, pagos (anulados marcados); **la contraseña temporal nunca aparece** | | |

### 13.D Estados, cancelación y eliminación

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 13.7 | 🔴 | Máquina de estados | SA-RF-09 CA1 | Solo `prueba→activo/cancelado`, `activo→suspendido/cancelado`, `suspendido→activo/cancelado`; el resto 422 | | |
| 13.34 | 🔴 | Suspender sin motivo | SA-RF-09 CA4 | Rechazado. Hoy solo cancelar exige motivo → anotar | | |
| 13.33 | 🔴 | ⛔ Reactivar sin pago | SA-RF-09 CA3 | Rechazado: el pago va en la misma operación; si el pago falla, el estado no cambia | | |
| 13.35 | 🔴 | ⛔ Reactivar no revive staff desactivado | SA-RF-09 | Jefe desactiva a un recepcionista → SA suspende el gym → SA reactiva → **el recepcionista sigue desactivado**. Hoy `gym_use_cases.py:293-298` pone `activo=true` a todos | | |
| 13.8 | 🟢 | Cancelar gimnasio | SA-RF-10 CA1 | Bloqueo inmediato; guarda fecha y motivo; conserva los datos | | |
| 13.36 | 🔴 | Operar sobre un cancelado | SA-RF-10 CA2 | Pago, regenerar credenciales y "Entrar como" → rechazados | | |
| 13.19 | 🟢 | ⛔ Exportación al cancelar | SA-RF-30 | Se genera ZIP con CSV en servidor propio; enlace válido 30 días; cada descarga en auditoría | | |
| 13.22 | 🔴 | ⛔ Enlace vencido | SA-RF-30 CA2 | 410 | | |
| 13.17 | 🟢 | ⛔ "Listo para eliminar" al día 30 | §2.4, SA-RF-01 CA5 | El Inicio lo muestra; antes del día 30 no | | |
| 13.20 | 🔴 | ⛔ Eliminar antes de los 30 días | SA-RF-31 CA1 | Deshabilitado | | |
| 13.21 | 🟢 | ⛔ Eliminación definitiva | SA-RF-31 CA2-4 | Exige escribir el subdominio; borra datos del tenant; invalida el enlace; **libera el subdominio** (se puede crear otro con el mismo); la auditoría del SA conserva el evento sin datos del tenant | | |

### 13.E Credenciales y soporte

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 13.9 | 🟢 | Regenerar credenciales | SA-RF-12 | La contraseña anterior (temporal o definitiva) **deja de servir de inmediato**; cierra las sesiones del jefe; la nueva vence en 72 h | | |
| 13.42 | 🔴 | Contraseña temporal a las 73 h | SA-RF-11 CA6 | El login indica contactar a MVC | | |
| 13.43 | 🔴 | Contraseña temporal en claro | SA-RF-11 CA2 | No aparece en BD, logs, auditoría ni ningún otro endpoint (buscar el valor mostrado en `superadmin.*` y en los logs del contenedor) | | |
| 13.37 | 🔴 | ⛔ Primer ingreso del jefe | SA-RF-11 CA7 | Obliga a cambiar la contraseña. Mismo hueco que 1.14 | | |
| 13.38 | 🟢 | ⛔ Editar correo del jefe | SA-RF-29 | Rechaza si ya existe en el gimnasio; exige regenerar después; auditoría con el correo anterior y el nuevo | | |
| 13.39 | 🟢 | ⛔ Entrar como / finalizar soporte | SA-RF-19, 20 | Motivo obligatorio; token de 1 h y un solo uso; banner permanente; auditoría del gimnasio con `impersonando=true` visible para el jefe; finalizar invalida el token (401 al reusar); no en cancelados | | |
| 13.40 | 🟢 | ⛔ Notas internas | SA-RF-28 | Texto, autor, fecha; no se editan | | |

### 13.F Autenticación del SA

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 13.23 | 🔴 | Sesión con cookie | SA-RF-00.1 CA1 | Cookie `HttpOnly`, `Secure`, `SameSite=Strict`. Hoy es JWT Bearer → anotar como brecha, no como fallo | | |
| 13.24 | 🔴 | Recuperación: un solo uso, 1 h, cierra sesiones | SA-RF-00.2 | Reusar → rechazado; a los 61 min → rechazado (hoy vence a 2 h); cambiar contraseña invalida las sesiones | | |
| 13.25 | 🔴 | Logout y expiración | SA-RF-00.3 | Reusar el token tras logout → 401; tras 1 h → 401 y la UI redirige conservando la ruta | | |
| 13.26 | 🔴 | 5 intentos fallidos con mensaje genérico | SA-RF-00.4 CA1 | Bloqueo 15 min; **el mensaje no cambia** (hoy devuelve 423 "Cuenta temporalmente bloqueada" → ❌ menor); un ingreso exitoso reinicia el contador | | |

---

## Bloque 14 — Super-Admin: cobros, fecha de corte, catálogo y auditoría

**RF:** SA-RF-14, 16, 17, 18, 21 a 26. Regla §3.

### 14.A Pagos

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 14.1 | 🟢 | Registrar pago | SA-RF-16 CA1, CA3 | Monto > 0, meses ≥ 1, `fecha_pago` ≤ hoy; la fecha de corte que muestra la UI antes de guardar coincide con la que devuelve el servidor | | |
| 14.3 | 🔴 | Doble envío del mismo pago | SA-RF-16 CA2 | Misma `Idempotency-Key` → un solo pago | | |
| 14.16 | 🔴 | Monto distinto al esperado / pago a cancelado | SA-RF-16 CA4-5 | Monto ≠ valor vigente × meses → aviso que **no** bloquea; gimnasio cancelado → rechazado; suspendido → solo vía reactivación | | |
| 14.2 | 🟢 | Anular pago con motivo | SA-RF-18 | Queda marcado, no se borra; **recalcula la fecha de corte hacia atrás** y el estado calculado; los ingresos del mes bajan | | |
| 14.17 | 🔴 | Anular dos veces | SA-RF-18 CA1 | 409 | | |
| 13.11 | 🟢 | Cambiar el valor mensual | SA-RF-14 | Crea registro nuevo con `vigencia_desde` y cierra el anterior; los meses ya pagados no cambian | | |

### 14.B Fecha de corte — los 6 CA de §3 (tests unitarios sobre `CuttingDateCalculator`)

Se prueban contra `plataforma/super-admin-api/app/domain/services/cutting_date_calculator.py` con
pytest, sin base de datos. Son la especificación literal de §3.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 14.10 | 🟢 | Inicio 31-ene + 1 mes | §3 CA1 | Corte = último día de febrero (28 o 29) | | |
| 14.11 | 🟢 | Inicio 31-ene + pagos de 1 y 1 meses | §3 CA2 | Corte = **31-mar**, no 28-mar (suma en un solo paso, no encadenada) | | |
| 14.12 | 🟢 | Pagos 1, 3 y 1 con el de 3 anulado | §3 CA3 | Corte = ancla + 2 meses | | |
| 14.13 | 🟢 | Corte 10-mar, pago de 1 mes el 12-mar (en gracia) | §3 CA4 | Corte = 10-abr (continúa desde el corte) | | |
| 14.14 | 🟢 | ⛔ Corte 10-mar, pago de 1 mes el 20-mar (bloqueado) | §3 CA5 | Corte = **20-abr** (el pago es la nueva ancla). Hoy da 10-abr: no hay regla del ancla | | |
| 14.15 | 🟢 | Todos los pagos anulados | §3 CA6 | Corte = ancla (o inicio + 5 días si es prueba) | | |

### 14.C Catálogo y auditoría

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 14.4 | 🟢 | Catálogo global | SA-RF-21, 22 | Listar, buscar en español e inglés, filtrar por grupo muscular / equipo / estado, crear con al menos un nombre, imagen en servidor propio, origen importado/manual | | |
| 14.5 | 🔴 | Desactivar ejercicio en uso | SA-RF-23 | No se elimina; en las plantillas de los gimnasios sigue, sin imagen | | |
| 14.6 | 🟢 | Importar dataset | SA-RF-24 CA1 | No duplica por (`origen`, `id_externo`) | | |
| 14.18 | 🟢 | Re-importar no pisa lo editado | SA-RF-24 CA2 | Editar `nombre_es` a mano → re-importar → `nombre_es` se conserva; los campos del dataset se actualizan | | |
| 14.9 | 🟢 | Importación parcial | SA-RF-24 CA3-4 | Una imagen que falla queda en el reporte; el resto continúa; reintentar no duplica | | |
| 14.7 | 🟢 | **Cadena de hash de auditoría** | SA-RF-25 CA3 | `/verify-chain` pasa sobre la tabla intacta | | |
| 14.8 | 🔴 | Romper la cadena | SA-RF-25 CA3 | Alterar una fila (deshabilitando el trigger a propósito) → la verificación **debe detectarlo** | | |
| 14.20 | 🔴 | Auditoría inmutable en base | SA-RF-25 CA2 | `UPDATE`/`DELETE` sobre `superadmin.auditoria` → `auditoria es append-only` (`01_schema.sql:276-280`) | | |
| 14.21 | 🔴 | Auditoría falla → operación falla | SA-RF-25 CA1 | Forzar error en el insert de auditoría (p. ej. columna NOT NULL) → el pago no queda registrado | | |
| 14.19 | 🟢 | Consulta con filtros | SA-RF-26 | Por usuario, acción, gimnasio y fechas; solo lectura | | |

---

## Bloque 15 — Efecto del estado del gimnasio en el sistema web (GW-RF-51)

Es el espejo de 13.A desde el lado del gimnasio. Hoy solo funciona la parte de suspensión manual
(`tenant.activo`); todo lo que depende de `fecha_corte` es ⛔.

| # | Tipo | Caso | RF | Resultado esperado | Resultado | Notas |
|---|---|---|---|---|---|---|
| 15.1 | 🟢 | ⛔ Contador desde 5 días antes | GW-RF-51 CA1 | Todos los roles ven "N días para el corte" | | |
| 15.2 | 🟢 | ⛔ Días 1–3 después del corte | GW-RF-51 CA2 | Todo funciona, con aviso visible | | |
| 15.3 | 🔴 | ⛔ Día 4 después del corte | GW-RF-51 CA3 | Login muestra "servicio bloqueado" con contacto de MVC; la API responde 403 a toda operación; la landing dice "no disponible" | | |
| 15.4 | 🔴 | Suspensión manual | GW-RF-51 CA3, §2.3 | Mismo efecto que 15.3 (esto sí existe: `GIMNASIO_SUSPENDIDO`) | | |
| 15.5 | 🔴 | ⛔ Prueba vencida | GW-RF-51 CA3 | Bloqueo inmediato, sin gracia | | |
| 15.6 | 🟢 | Turno abierto durante el bloqueo | GW-RF-51 CA4 | Se conserva tal cual; se puede cerrar cuando se levanta el bloqueo; nada se pierde | | |

---

## Registro de resultados

| Bloque | Casos | de ellos ⛔ | ⏸ | ✅ | ❌ | Sin probar | Bloqueantes |
|---|---|---|---|---|---|---|---|
| 0 — Aislamiento | 9 | 1 | 0 | | | | |
| 1 — Auth GW | 17 | 2 | 0 | | | | |
| 2 — Ingreso y estado | 25 | 0 | 1 | | | | |
| 3 — Caja | 28 | 6 | 0 | | | | |
| 4 — Membresías y paquetes | 28 | 14 | 0 | | | | |
| 5 — Deportistas | 14 | 0 | 3 | | | | |
| 6 — Clases | 19 | 1 | 0 | | | | |
| 7 — Entrenamiento | 11 | 0 | 0 | | | | |
| 8 — Inventario | 9 | 0 | 0 | | | | |
| 9 — Personal | 11 | 1 | 0 | | | | |
| 10 — Reportes | 9 | 1 | 0 | | | | |
| 11 — MyGymOS | 12 | 1 | 0 | | | | |
| 12 — Frontend | 7 | 0 | 0 | | | | |
| 13 — SA ciclo de vida | 42 | 19 | 0 | | | | |
| 14 — SA cobros y catálogo | 22 | 1 | 0 | | | | |
| 15 — Estado del gym en GW | 6 | 4 | 0 | | | | |
| **Total** | **269** | **51** | **4** | | | | |

**Lectura rápida:** de 269 casos, 51 (19 %) no se pueden probar porque el requisito no está
construido, y 4 están postergados. Los **214 restantes** son los que se ejecutan hoy.

**Criterio de salida:** ningún ❌ en el bloque 0, ni en los casos 🔴 no-⛔ de los bloques 2, 3, 9 y
13.D. Esos son fugas de datos, de dinero o de control, no defectos cosméticos. Los ⛔ no cuentan
para el criterio de salida del *plan*; cuentan para el criterio de salida de la *v1*, que está en
`MATRIZ_TRAZABILIDAD.md` ("Lo que hay que construir").

---

## Deuda de este plan

1. **Nombres de estado.** El código usa `inactivo`/`cancelada`/`mora`; los requisitos fijan
   `desactivado`/`cancelado`/`en_gracia`. Es un rename con impacto en API, frontend y este plan.
2. **Prefijos `SA-`/`GW-` en el código.** Los docstrings dicen `RF-16` a secas en las dos APIs, y el
   número significa cosas distintas en cada una. Adoptar el prefijo en código.
3. **La suite del producto no es ejecutable.** `producto/gym-jefe-api/tests/` son 3.365 líneas en 9
   archivos que **no son pytest**: cada uno es un script con `asyncio.run()` al final. No hay
   `pytest.ini` ni `conftest.py`. La plataforma sí tiene 39 pruebas pytest. Los 6 CA de §3 (14.B)
   deberían ser lo primero que se automatice: son puros y no necesitan base.
4. **El frontend no tiene ni una prueba.** Cero `.test.*` o `.spec.*` en los dos frontends.
5. **`docs/INVENTARIO_ENDPOINTS.md` está desactualizado.** Declara 87 endpoints; el OpenAPI en vivo
   devuelve 146. Regenerarlo desde OpenAPI.
6. **Las pruebas existentes corrían sobre SQLite.** RLS, UUID y concurrencia no existen ahí; los
   bloques 0, 6.6 y 8.7 son imposibles de probar en SQLite. Cualquier automatización de este plan
   corre contra el Postgres de `infra/db/`.
7. **Endpoint `/credentials/resend` huérfano.** El RF-13 se fusionó en SA-RF-12; el endpoint sigue.
