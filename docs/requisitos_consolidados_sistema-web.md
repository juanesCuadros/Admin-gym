# GymOS — Sistema Web del Gimnasio · Requisitos consolidados v2

**Fuentes:** `GymOS_SistemaWeb_Requisitos_v1.docx` · `vistas_00_reglas-generales.md` · `00_decisiones-consolidacion.md`.

**Convenciones**
- Prioridad: **Must** / **Should** / **Could**.
- `CA` = criterio de aceptación (Dado / Cuando / Entonces); cada CA es un test.
- Los IDs `GW-RF-xx` conservan el número del Doc 2; los nuevos empiezan en 51.
- La organización sigue los módulos **00–13** de `vistas_00`.
- Fechas en America/Bogota, corte de día a medianoche. Montos en COP enteros.

---

## 1. Alcance, actores y plataforma

| Actor | Acceso |
|---|---|
| Jefe | Todo lo del Recepcionista, más planes, personal, permisos, reportes, configuración y auditoría. Único por gimnasio |
| Recepcionista | Caja, ventas, pagos, ingreso, deportistas, reservas y asistencia |
| Entrenador | Plantillas y asignación de rutinas; clases solo si tiene el permiso |
| Pantalla TV | Modo de visualización de Control de ingreso, en el monitor de recepción |
| Sistema | Estados calculados, validación de acceso y auditoría |

**Plataforma v1:** todas las interfaces son web, incluida Recepción. El check-in manual es el camino de ingreso.

**Autorización:** rol base + matriz de permisos por submódulo, validada en el backend en **cada** petición.

**Postergado (fase escritorio):** huella (GW-RF-01, 02, 22), comando al torniquete y modo sin internet.
**Postergado (app):** activación de la app (GW-RF-18) y alineación de mediciones con la app v4.

---

## Módulo 00 · Reglas transversales

### Estado del deportista (calculado, nunca guardado)

Se evalúa en este orden y gana el primero que se cumple.
Definiciones: `g` = días de gracia; `p` = días de "por vencer", ambos del gimnasio. `venc` = vencimiento de la membresía.

| # | Estado | Condición | ¿Ingresa? | ¿Reserva? | ¿Congela? |
|---|---|---|---|---|---|
| 1 | `desactivado` | Registro desactivado | No | No | No |
| 2 | `cancelado` | Membresía cancelada | No | No | No |
| 3 | `sin_membresia` | Nunca tuvo membresía | No | No | No |
| 4 | `congelado` | hoy ∈ [inicio, fin] de un congelamiento | No | No | — |
| 5 | `vencido` | hoy > venc + g | No | No (compra pase) | No |
| 6 | `en_gracia` | venc < hoy ≤ venc + g | **Sí, con alerta** | No | No |
| 7 | `por_vencer` | 0 ≤ venc − hoy ≤ p | Sí | Sí, hasta venc | Sí |
| 8 | `activo` | resto | Sí | Sí, hasta venc | Sí |

- `venc` se deriva de los pagos no anulados más los días congelados.
- Un congelamiento que termina no requiere ningún proceso: el estado se recalcula al consultarlo.
- Cambiar un parámetro afecta solo las evaluaciones posteriores.

**CA**
- CA1: Con g = 3 y vencimiento ayer → `en_gracia`.
- CA2: Con g = 3 y vencimiento hace 4 días → `vencido`.
- CA3: Con g = 0 y vencimiento ayer → `vencido`.
- CA4: Membresía vencida y con un congelamiento vigente → `congelado`.

### GW-RF-51 Estado de la suscripción del gimnasio — Must

Usa los estados calculados del Super-Admin (`por_vencer`, `en_gracia`, `bloqueado`).

- CA1: Desde 5 días antes de la fecha de corte, todos los roles ven un contador de días restantes.
- CA2: Durante los días 1–3 después del corte el sistema funciona, con un aviso visible.
- CA3: Si el gimnasio está bloqueado, suspendido o cancelado, o su prueba venció, **ningún rol puede operar**: el login muestra "servicio bloqueado" con el contacto de MVC, la API responde 403 a toda operación y la landing muestra "no disponible".
- CA4: Si en ese momento hay un turno abierto, se conserva tal cual y se cierra cuando se levante el bloqueo.

### Regla de auditoría (definida en `vistas_00`)

Toda escritura sobre dinero, membresías, permisos o inventario se registra de forma inmutable (ver módulo 13).

---

## Módulo 01 · Autenticación

**GW-RF-00.1 Iniciar sesión (access + refresh)** — Must
- CA1: El refresh token rota en cada uso; si se reutiliza uno ya rotado, se revoca toda su familia.
- CA2: El login está atado al subdominio: un usuario del gimnasio A no entra en el subdominio de B.
- CA3: Con contraseña temporal, el primer ingreso obliga a cambiarla.
- CA4: Si un Recepcionista inicia sesión y no hay turno abierto, debe abrir caja antes de continuar. El Jefe y el Entrenador no tienen esa restricción.
- CA5: Aplica GW-RF-51 CA3.

**GW-RF-00.2 Recuperar contraseña** — Must
- CA1: La respuesta es idéntica exista o no el correo.
- CA2: El enlace es de un solo uso y vence en 1 h.
- CA3: Al cambiar la contraseña se cierran todas las sesiones.

**GW-RF-00.3 Cerrar sesión / expiración** — Must
- CA1: El logout revoca el refresh token en el servidor.
- CA2: La sesión expira por inactividad según el parámetro del gimnasio (por defecto 1 h).

**GW-RF-00.4 Bloqueo por intentos** — Should
- CA1: Tras 5 intentos fallidos, bloqueo de 15 min con mensaje genérico; un ingreso exitoso reinicia el contador.

---

## Módulo 02 · MyGymOS (configuración)

**GW-RF-45 Información general** — Must
- CA1: Nombre, dirección, contacto, redes y horarios; cada cambio queda en auditoría.

**GW-RF-46 Mi landing** — Should
- CA1: El Jefe edita el contenido (textos, imágenes, horarios) dentro de la plantilla que mantiene MVC; la estructura no se puede cambiar.
- CA2: Muestra el enlace público y un código QR.

**GW-RF-47 Métodos de pago** — Must
- CA1: Llegan precargados desde el provisioning; desactivar uno no altera los pagos anteriores.

**GW-RF-48 Parámetros del gimnasio** — Must

| Parámetro | Regla |
|---|---|
| Días de gracia | Entero ≥ 0 (0 = sin gracia) |
| Días "por vencer" | Entero ≥ 0 |
| Mínimo de días por congelamiento | Entero ≥ 1 |
| Tope de días de congelamiento por membresía | Entero ≥ mínimo |
| Permitir descuentos | Sí / No |
| Tope de descuento | 0–100 % |
| Duración de sesión por inactividad | 15 min – 8 h (por defecto 1 h) |
| Ventana de reserva | Días de anticipación con que se puede reservar |
| Límite para cancelar reserva | Horas antes de la clase |

- CA1: Un valor fuera de rango se rechaza con 422.
- CA2: El cambio aplica desde la siguiente evaluación y queda en auditoría.

---

## Módulo 03 · Personal y permisos

**GW-RF-00.5 Matriz de permisos** — Must
- CA1: Un cambio aplica en la siguiente petición del usuario afectado.
- CA2: Si el usuario está en el módulo cuando pierde el permiso, recibe 403 y la UI lo saca con un aviso.
- CA3: Los permisos del Jefe no se pueden quitar.
- CA4: Pedir un recurso de otro gimnasio responde **404**, no 403.

**GW-RF-39 Staff** — Must
- CA1: El Jefe crea la cuenta (nombre, correo, rol). Se genera una credencial temporal de 72 h que se muestra una sola vez y exige cambio en el primer ingreso.
- CA2: El correo es único por gimnasio.
- CA3: El Jefe edita, activa o desactiva y reasigna roles. Desactivar a alguien cierra sus sesiones de inmediato.
- CA4: Desactivar a un recepcionista con turno abierto **no** cierra el turno; lo cierra la siguiente recepcionista con la regla de turno ajeno (GW-RF-08).

**GW-RF-40 Jefe único** — Must
- CA1: La transferencia es atómica: el nuevo Jefe debe ser staff activo y el anterior pasa al rol que se elija.
- CA2: Un constraint en BD impide que queden 0 o 2 Jefes.
- CA3: Si se pierde el acceso, MVC regenera credenciales o cambia el correo del Jefe desde el SA.

---

## Módulo 04 · Planes

**GW-RF-24 Planes configurables** — Must
- CA1: Campos: nombre, precio, duración y **número de beneficiarios** (1 = individual; 2 o más = grupal).
- CA2: La venta guarda una copia del plan (precio, duración y beneficiarios); editar el plan después no afecta lo ya vendido.
- CA3: Desactivar un plan impide venderlo y renovarlo, pero no afecta las membresías vigentes.

---

## Módulo 05 · Inventario

**GW-RF-36 Productos** — Must
- CA1: Crear, editar, activar/desactivar y fijar precio. La venta guarda el precio del momento.

**GW-RF-37 Stock** — Must
- CA1: Una entrada suma stock. Un ajuste suma o resta, y exige motivo, permiso y auditoría.
- CA2: Un ajuste no puede dejar el stock en negativo.

**GW-RF-38 Descuento de stock en la venta** — Must
- CA1: La venta se bloquea si el producto no existe o está inactivo, si el stock es 0 o si la cantidad supera el stock.
- CA2: Si dos ventas simultáneas piden la última unidad, solo una se completa (bloqueo en la transacción).

---

## Módulo 06 · Deportistas

**GW-RF-17 Registro** — Must
- CA1: El documento (tipo + número) es único **por gimnasio**; el mismo documento puede existir en otro gimnasio.
- CA2: El correo se puede repetir.
- CA3: **Visitante con pase de día:** registro mínimo (nombre, documento y consentimiento).
- CA4: **Menor de edad:** exige los datos del acudiente y su autorización.
- CA5: Al desactivar a alguien con membresía vigente se muestra una advertencia.

**GW-RF-19 Consentimiento (Ley 1581)** — Must
- CA1: Sin el checkbox marcado, la inscripción no se completa.
- CA2: Se guardan la fecha, la versión del texto aceptado y quién lo registró.

**GW-RF-20 Ficha** — Must
- CA1: Muestra datos, estado calculado, membresías (incluido el paquete al que pertenece), pagos (con los anulados marcados), accesos y rutinas.

**GW-RF-21 Mediciones** — Must
- CA1: Las registra el staff.

**GW-RF-23 Supresión de datos** — Should
- CA1: Borra fotos y datos biométricos, y anonimiza los datos personales. Los pagos se conservan con una referencia anónima.
- CA2: Exige confirmación explícita, es irreversible y la auditoría no guarda datos personales.
- CA3: Si la persona era titular de un paquete, el contacto de renovación pasa al siguiente beneficiario mayor de edad.

---

## Módulo 07 · Membresías

**GW-RF-25 Asignar, renovar, cambiar y cancelar** — Must
- CA1: **Renovar una membresía vigente:** suma desde el vencimiento, sin perder días.
- CA2: **Renovar en gracia o vencida (regla C2):** si el deportista hizo check-in en algún día de gracia (venc+1 … venc+g), el nuevo periodo cuenta desde `venc`; si no, desde el día de la renovación.
- CA3: **Cambio de plan:** el plan nuevo empieza cuando termina el actual; sin prorrateo y sin pérdida de días.
- CA4: **Cancelación:** inmediata, sin reembolso, solo con permiso y con motivo.

**CA de C2 (con g = 3)**
- Entró el día venc+1 y renueva el venc+6 → cuenta desde `venc`.
- No entró en la gracia y renueva el venc+3 → cuenta desde venc+3.
- No entró en la gracia y renueva el venc+10 → cuenta desde venc+10.

**GW-RF-26 Congelar** — Must
- CA1: Solo se puede congelar una membresía `activo` o `por_vencer`.
- CA2: Es una acción explícita del staff: registra inicio y fin, y extiende el vencimiento por los días congelados.
- CA3: Un congelamiento por debajo del mínimo, o que haga superar el tope acumulado de la membresía, se rechaza.
- CA4: Si se descongela antes de la fecha, solo cuentan los días efectivos.
- CA5: Mientras está congelada, el deportista no puede ingresar hasta descongelar.

**GW-RF-27 Estado calculado** — Must
- CA: los del módulo 00. No existe columna de estado en BD.

**GW-RF-52 Planes grupales (paquetes)** — Must

Una venta de un plan con N beneficiarios crea **N membresías individuales** ligadas a un mismo paquete.

| Caso | Regla |
|---|---|
| Titular | Es quien paga, debe ser **mayor de edad** y **siempre es uno de los beneficiarios**. Se elige en cada venta |
| Beneficiarios | Deben estar registrados, cada uno con su propio consentimiento (y el del acudiente si es menor) |
| Paquete incompleto | No se vende: exige exactamente N beneficiarios |
| Beneficiario con membresía vigente | Su membresía del paquete empieza cuando vence la actual |
| Precio | Se divide en partes iguales en enteros; el sobrante se asigna a la primera. En reportes el paquete cuenta una sola vez |
| Descuento | Se aplica al total, dentro del tope del gimnasio |
| Cambio de beneficiario | **No se permite** |
| Congelar, desactivar o cancelar | Afecta solo a la membresía de esa persona |
| Anular el pago | Revierte las N membresías en una sola operación |
| Renovar paquete | Extiende cada membresía desde su propio vencimiento, aplicando C2 por persona. Se vuelve a elegir titular |
| Solo algunos renuevan | No pueden renovar a precio de paquete; pasan a un plan individual |
| El titular se va (desactivado, cancelado o suprimido) | Las demás membresías siguen; el contacto de renovación pasa al siguiente beneficiario mayor de edad |
| Aviso "por vencer" | Se muestra el contacto del titular |
| Beneficiario de otra sede | No se puede: cada sede es un gimnasio aislado |

- CA1: Una venta con N − 1 beneficiarios se rechaza con 422.
- CA2: Un titular menor de edad se rechaza.
- CA3: Si falla la creación de una de las N membresías, no se crea ninguna.
- CA4: Si dos recepcionistas agregan a la misma persona a la vez, la restricción en BD rechaza el segundo intento.

---

## Módulo 08 · Caja

**GW-RF-08 Abrir turno** — Must
- CA1: Solo puede haber **un turno abierto por gimnasio**, porque el turno pertenece a la caja y no al usuario.
- CA2: Si hay un turno ajeno abierto, la recepcionista debe cerrarlo primero; el descuadre se atribuye a quien lo abrió.
- CA3: La base inicial de efectivo es opcional (≥ 0).

**GW-RF-09 Exigir turno** — Must
- CA1: Cobrar o vender sin turno abierto responde 409 **desde la API**, no solo en la UI.

**GW-RF-10 Cerrar turno** — Must
- CA1: Efectivo esperado = base + ingresos en efectivo − egresos − reversos en efectivo. Los demás medios de pago se muestran por separado.
- CA2: Se guardan el conteo y la diferencia. Se puede cerrar con descuadre; en ese caso queda marcado para que el Jefe lo revise y deje una nota.
- CA3: Un turno cerrado es inmutable y **nunca se reabre**.
- CA4: El turno no se cierra solo a medianoche; los reportes usan la fecha de cada movimiento.

**GW-RF-11 Punto de venta** — Must
- CA1: Una venta que incluye productos, membresías, paquetes y pases es atómica: si algo falla, no se guarda nada.
- CA2: Dos envíos con la misma `Idempotency-Key` registran una sola venta.

**GW-RF-12 Anular venta / devolución** — Must
- CA1: Exige permiso y motivo; la anulación es total y reintegra el stock. No se puede anular dos veces.
- CA2: El reverso se registra en el **turno abierto actual**, aunque la venta sea de un turno ya cerrado.
- CA3: Anular el pase de una clase cancelada sigue esta misma regla.

**GW-RF-13 Movimientos del turno** — Must
- CA1: Lista ventas, pagos, ingresos, egresos y reversos, cada uno con usuario y hora.

**GW-RF-14 Egresos y vales** — Must
- CA1: Exigen motivo y pueden dejar la caja en negativo sin bloquearla.

**GW-RF-15 Pago de membresía** — Must
- CA1: Pide el método (texto libre) y el tipo (efectivo u otro).
- CA2: Si el valor recibido supera el precio final, se muestra el cambio y se registra como monto el precio final, sin saldo a favor.
- CA3: Si el valor recibido es menor al precio final, se rechaza: no hay abonos.

**GW-RF-16 Anular pago de membresía** — Must
- CA1: Exige permiso y motivo, y queda en auditoría. El vencimiento se recalcula desde el historial.
- CA2: Los accesos ya ocurridos se conservan.
- CA3: El reverso se registra en el turno abierto actual.

**GW-RF-53 Descuentos y precio editable** — Must
- CA1: Solo está disponible si el parámetro "permitir descuentos" está activo y el usuario tiene el permiso.
- CA2: Un descuento mayor al tope configurado se rechaza.
- CA3: Exige motivo y queda en auditoría con el precio de lista y el precio cobrado.
- CA4: Aplica a productos, membresías y paquetes.

---

## Módulo 09 · Control de ingreso (incluye Pantalla TV)

**GW-RF-03 Check-in manual** — Must
- CA1: Busca por nombre o documento y aplica la regla de la columna "¿Ingresa?" del módulo 00.
- CA2: Registra cada intento con su resultado (permitido o denegado, con el motivo).
- CA3: Un deportista `en_gracia` ingresa, y recepción ve una alerta con los días vencidos.

**GW-RF-04 Regla de acceso** — Must
- CA: los del módulo 00. La gracia viene de GW-RF-48.

**GW-RF-05 Ingreso de cortesía** — Must
- CA1: Exige motivo y queda en auditoría. No crea check-in de deportista ni cuenta como asistencia.

**GW-RF-06 Ingresos del día** — Should
- CA1: Lista los check-ins del día. El conteo de "quién está adentro" queda para la fase escritorio.

**GW-RF-07 Pantalla TV** — Must
- CA1: Tras un ingreso **permitido** muestra "Bienvenido, {primer nombre}". Nunca muestra ingresos denegados.
- CA2: Muestra hora, logos, clases del día y avisos; sin actividad vuelve al estado por defecto.
- CA3: Se actualiza por WebSocket, sin polling. Si pierde la conexión, reconecta con espera creciente y recarga el estado actual.
- CA4: Funciona dentro de la misma sesión de recepción, en el monitor, sin emparejar ningún dispositivo.

---

## Módulo 10 · Entrenamiento

**GW-RF-28 Ejercicios** — Must
- CA1: Muestra el catálogo global más los ejercicios propios; los propios no son visibles para otros gimnasios (test de RLS).
- CA2: Activar y desactivar es por gimnasio. Un ejercicio desactivado sigue en las plantillas que lo usan, pero sin imagen.
- CA3: Muestra el nombre en español o, si no existe, en inglés.

**GW-RF-29 Plantillas** — Must
- CA1: Eliminar una plantilla no afecta las rutinas ya asignadas.
- CA2: Un ejercicio desactivado no se puede agregar a una plantilla.

**GW-RF-30 Rutinas asignadas (copia congelada)** — Must
- CA1: Editar la plantilla después de asignarla no cambia lo asignado.
- CA2: Un deportista puede tener varias rutinas.

**GW-RF-31 Rutinas por deportista** — Should

---

## Módulo 11 · Clases

**GW-RF-32 Programación** — Must
- CA1: La clase puede ser única o recurrente, con opción de omitir los festivos de Colombia (tabla de festivos mantenida por año).
- CA2: Al editar una clase recurrente se elige "solo esta" o "toda la serie".
- CA3: El cupo no puede quedar por debajo del número de reservas existentes.
- CA4: El profesor es un Entrenador del sistema o un "externo" (con nombre opcional).
- CA5: Cancelar una clase cancela sus reservas; los pases pagados se anulan con GW-RF-12.

**GW-RF-33 Reservas** — Must
- CA1: Solo reservan los deportistas `activo` o `por_vencer`. Los demás deben comprar un pase de clase en Caja.
- CA2: No se puede reservar una clase con fecha posterior al vencimiento de la membresía.
- CA3: Se respetan la ventana de reserva y el límite para cancelar configurados en GW-RF-48.
- CA4: Si dos personas piden el último cupo al mismo tiempo, solo una lo obtiene.
- CA5: Nadie puede reservar dos veces la misma clase.

**GW-RF-34 Asistencia** — Must
- CA1: Para registrar asistencia a una clase, el deportista debe haber hecho check-in en el gimnasio **ese mismo día**.
- CA2: La inasistencia no penaliza ni libera el cupo.

**GW-RF-35 Lista de espera** — Could

---

## Módulo 12 · Reportes

**GW-RF-41 Ingresos** — Must
- CA1: Filtra por periodo, fuente y método. Los pagos anulados se excluyen de los totales, pero se pueden consultar.
- CA2: Muestra el precio de lista frente al precio cobrado (descuentos). Un paquete cuenta como una sola venta.

**GW-RF-42 Membresías** — Must
- CA1: Lista de "por vencer" (según el umbral del gimnasio) con el contacto de cada deportista o, si es de un paquete, del titular. También lista activas y vencidas.

**GW-RF-43 Asistencia** — Should
- CA1: Muestra la afluencia por horario y los deportistas "sin asistencia N días" (métrica distinta del estado `desactivado`).

**GW-RF-44 Exportar** — Should
- CA1: Exporta exactamente lo filtrado, en CSV UTF-8 con BOM (para que Excel muestre bien las tildes) y en Excel.

---

## Módulo 13 · Auditoría

**GW-RF-49 Registro inmutable** — Must
- CA1: Aplica los mismos criterios que SA-RF-25: se escribe en la misma transacción, un trigger impide modificarla, lleva cadena de hash y no guarda secretos.
- CA2: Solo el Jefe la ve, e incluye las sesiones de "Entrar como" del SA con el actor real.

**GW-RF-50 Consulta con filtros** — Should

---

## Requisitos no funcionales

| ID | Atributo | Requisito | Verificación |
|---|---|---|---|
| GW-RNF-01 | Seguridad | Contraseñas con Argon2id; permisos validados en cada petición | GW-RF-00.5 |
| GW-RNF-02 | Multi-tenancy | RLS por `gym_id`, *fail-closed* | Test: sin tenant configurado se ven 0 filas; desde el gimnasio A, un recurso de B responde 404 |
| GW-RNF-03 | Integridad | Operaciones de dinero y stock atómicas; `Idempotency-Key` en todas las de dinero | GW-RF-11, GW-RF-52 |
| GW-RNF-04 | Auditabilidad | Solo inserción; se conserva el actor real | GW-RF-49 |
| GW-RNF-05 | Tiempo real | TV por WebSocket con reconexión automática | GW-RF-07 |
| GW-RNF-06 | Usabilidad | Español; formatos de fecha, hora y moneda de Colombia; tablas de 20 filas; éxito en aviso flotante y error en mensaje fijo (`vistas_00`) | Revisión UI |
| GW-RNF-07 | Zona horaria | Timestamps en UTC; visualización y corte de día en America/Bogota | Test de check-in a las 19:30 hora local (00:30 UTC) |
| GW-RNF-08 | Rendimiento | Listados paginados; búsqueda indexada por nombre y documento | `EXPLAIN` |
| GW-RNF-09 | Escalabilidad | De uno a decenas de gimnasios sin rediseño | — |
| GW-RNF-10 | Dinero | COP como enteros | Esquema |
| GW-RNF-11 | Construcción | Las migraciones son la única fuente del esquema. Tipos TS generados desde OpenAPI. Tests contra PostgreSQL real. Smoke test del sistema combinado (SA + GW) antes de pasar de fase | CI |

## Fuera de alcance v1

Abonos y pagos parciales · saldo a favor · prorrateo · penalización por inasistencia · mover reservas · corte de día configurable · facturación electrónica y pasarela de pago · cambio de beneficiarios en paquetes · huella, torniquete y modo sin internet (fase escritorio) · app móvil.
