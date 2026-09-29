# GymOS — Super-Admin · Requisitos consolidados v2

**Fuentes:** `Requisitos-SuperAdmin.docx` v1.0 · `GymOS_SuperAdmin_Pantallas.md` · `AUDITORIA-y-BD.md` · `00_decisiones-consolidacion.md`.

**Convenciones**
- Prioridad: **Must** (v1 no sale sin esto) · **Should** (iteración inmediata) · **Could**.
- `CA` = criterio de aceptación en formato Dado / Cuando / Entonces. Cada CA es un test.
- Fechas de negocio en America/Bogota. Montos en COP enteros.

---

## 1. Alcance y actores

Panel interno de MVC para el ciclo de vida de los gimnasios: alta, cobro, soporte, baja y catálogo global de ejercicios.

**Stack:** FastAPI + React + PostgreSQL. App separada, usuario de BD propio, dominio propio, sesión con cookie.

| Actor | Descripción |
|---|---|
| Usuario MVC | Rol único con acceso total (2–3 personas), creado directamente en BD |
| Sistema | Cálculo de fecha de corte y estados derivados; registro de auditoría |

**Fuera de alcance:** pantalla Equipo y roles · MFA · outbox, jobs, webhooks y n8n · aviso por correo · feature flags · métricas de uso por gimnasio · plantillas de correo editables · facturación y pasarela de pago.

## 2. Estados del gimnasio

### 2.1 Estados guardados y transiciones

| Desde → Hacia | Condición | Efecto |
|---|---|---|
| (alta) → `prueba` | Tipo de inicio = prueba | corte = inicio + 5 días |
| (alta) → `activo` | Cliente activo + pago inicial | corte según §3 |
| `prueba` → `activo` | Pago en la misma operación | Ancla = fecha del pago |
| `prueba` / `activo` → `suspendido` | Manual, con motivo | Mismo efecto que el bloqueo (§2.3) |
| `suspendido` → `activo` | Pago en la misma operación | Ancla = fecha del pago |
| cualquiera → `cancelado` | Manual, con motivo | Flujo de cancelación (§2.4) |

Cualquier otra transición se rechaza.

### 2.2 Estados calculados (nunca se guardan)

Sea `d = hoy − fecha_corte`:

| Estado calculado | Condición | Efecto en el Sistema Web |
|---|---|---|
| `al_dia` | d < −5 | Normal |
| `por_vencer` | −5 ≤ d ≤ 0 | Contador visible dentro del sistema |
| `en_gracia` | 1 ≤ d ≤ 3 | Funciona, con aviso |
| `bloqueado` | d ≥ 4, **o** prueba con d ≥ 1 | Todo bloqueado |

- El bloqueo se calcula en cada consulta, sin ningún proceso programado.
- El gimnasio está cubierto hasta el final del día `fecha_corte`.
- `prueba_por_vencer` (panel interno de MVC): estado `prueba` y 0 ≤ corte − hoy ≤ 2.

### 2.3 Efecto del bloqueo y de la suspensión

- Ningún rol del gimnasio puede operar. Al iniciar sesión se ve una pantalla de "servicio bloqueado" con el contacto de MVC.
- La landing pública muestra "no disponible".
- Los datos no se modifican.

### 2.4 Flujo de cancelación

1. Al cancelar: bloqueo inmediato y se genera un enlace de exportación válido 30 días.
2. Día 30: el Inicio muestra el gimnasio como "listo para eliminar".
3. MVC confirma la eliminación: se borran los datos del gimnasio y se libera el subdominio. MVC conserva sus propios registros (pagos a GymOS y auditoría del SA).
4. Si el gimnasio vuelve, entra como cliente nuevo y firma contrato.

## 3. Regla de fecha de corte

```
ancla        = fecha_inicio, o la fecha del último pago registrado estando bloqueado o suspendido
meses        = Σ meses de pagos NO anulados desde el ancla (incluido el pago que la fijó)
fecha_corte  = sumar_meses(ancla, meses)    ← en UN solo paso, con ajuste a fin de mes
```

- **Pago al día o en gracia:** suma sobre el ancla vigente; el periodo continúa desde la fecha de corte.
- **Pago estando bloqueado o suspendido:** ese pago se vuelve la nueva ancla.
- `fecha_corte` en la tabla `gimnasios` es un valor en caché; se recalcula en la misma transacción de cada pago o anulación.
- **Valor mensual no retroactivo:** un cambio de valor no toca los meses ya pagados. El aviso de monto (SA-RF-16 CA5) compara contra el valor vigente en la fecha de cada pago.

**CA (tests unitarios)**
- CA1: Inicio 31-ene + 1 mes → corte = último día de febrero.
- CA2: Inicio 31-ene + pagos de 1 y 1 meses → corte = 31-mar (no 28-mar).
- CA3: Pagos de 1, 3 y 1 meses con el de 3 anulado → corte = ancla + 2 meses.
- CA4: Corte 10-mar y pago de 1 mes el 12-mar (en gracia) → corte = 10-abr.
- CA5: Corte 10-mar y pago de 1 mes el 20-mar (bloqueado) → corte = 20-abr.
- CA6: Todos los pagos del segmento anulados → corte = ancla.

## 4. Requisitos funcionales

### M0 · Autenticación

**SA-RF-00.1 Iniciar sesión** — Must
- CA1: Con credenciales válidas se crea una sesión en servidor con cookie `HttpOnly`, `Secure` y `SameSite=Strict`, y se redirige a Inicio.
- CA2: Con credenciales inválidas o usuario desactivado se muestra el mismo mensaje genérico, sin revelar si el correo existe.

**SA-RF-00.2 Recuperar contraseña** — Must
- CA1: Exista o no el correo, la respuesta es la misma.
- CA2: El enlace es de un solo uso y vence en 1 h. Si ya se usó o venció, se rechaza.
- CA3: Cambiar la contraseña cierra todas las sesiones del usuario.

**SA-RF-00.3 Cerrar sesión / expiración** — Must
- CA1: Cerrar sesión la invalida en el servidor; reutilizar la cookie devuelve 401.
- CA2: Tras 1 h de inactividad (valor fijo en la configuración del servidor), la siguiente petición devuelve 401 y redirige al login conservando la ruta.

**SA-RF-00.4 Bloqueo por intentos** — Must
- CA1: Tras 5 intentos fallidos, el correo queda bloqueado 15 min; durante el bloqueo incluso la contraseña correcta recibe el mensaje genérico.
- CA2: Un ingreso exitoso reinicia el contador.

### M1 · Inicio

**SA-RF-01 Métricas** — Must
- CA1: Muestra gimnasios por estado guardado y, aparte, los calculados: por vencer, en gracia, bloqueados y pruebas por vencer.
- CA2: Ingresos del mes = Σ pagos no anulados con `fecha_pago` dentro del mes (Bogotá).
- CA3: Un pago anulado se descuenta en la siguiente carga.
- CA4: El total de miembros se lee de la vista de conteos; el usuario del SA no tiene permiso sobre las tablas del tenant.
- CA5: Muestra los gimnasios "listos para eliminar" (§2.4).

**SA-RF-02 Tabla de urgencia** — Must
- CA1: Orden: bloqueados → en gracia → pruebas por vencer → por vencer → resto (por días restantes, ascendente).
- CA2: Los cancelados no aparecen.

### M2 · Gimnasios

**SA-RF-03 Listar** — Must
- CA1: Busca por nombre (parcial, sin distinguir mayúsculas ni tildes) o por subdominio.
- CA2: Pagina de a 20. Sin resultados muestra estado vacío; sin gimnasios, el acceso para crear el primero.
- CA3: Filtra por estados guardados y calculados.

**SA-RF-04 Crear gimnasio (4 pasos)** — Must
- CA1: No avanza con campos inválidos; el servidor vuelve a validar todo.
- CA2: Si la creación falla, los datos se conservan y el reintento usa la misma `Idempotency-Key`, sin duplicar.
- CA3: Un doble clic en "Crear" produce un solo gimnasio.
- CA4: Salir con cambios sin guardar muestra un aviso.
- CA5: Galería de hasta 8 imágenes jpg/png/webp de máximo 2 MB cada una. Descripción de máximo 300 caracteres. Redes sociales opcionales.
- CA6: El NIT no es único (un dueño puede tener varias sedes).
- CA7: Antes de confirmar se muestra un resumen completo.

**SA-RF-05 Subdominio** — Must
- CA1: Se autogenera en minúsculas, sin tildes y con espacios convertidos en guion (`Gimnasio Ñandú` → `gimnasio-nandu`).
- CA2: Formato: solo `a-z`, `0-9` y `-`; no empieza ni termina en guion; de 3 a 63 caracteres (límite de etiqueta DNS, RFC 1035).
- CA3: Se rechazan las palabras reservadas `admin`, `www`, `api`, `app` y `mail`.
- CA4: La unicidad la garantiza un constraint en BD: si dos altas simultáneas piden el mismo subdominio, la segunda recibe 409.
- CA5: Un subdominio solo queda disponible después de la eliminación definitiva del gimnasio que lo usaba.

**SA-RF-06 Provisioning (asistido)** — Must
- CA1: En una sola transacción crea el tenant (`gym_id`), la cuenta del Jefe con el hash de la contraseña temporal, los métodos de pago por defecto (efectivo, tarjeta, transferencia) y los parámetros iniciales del gimnasio.
- CA2: El catálogo global queda visible sin ningún ejercicio activado.
- CA3: La landing se publica con la plantilla base.
- CA4: Si un paso falla, el reintento retoma desde ese paso (`provisioning_pasos`) sin duplicar lo ya creado.

**SA-RF-07 Ficha** — Must
- CA1: Muestra datos, estado guardado y calculado, días restantes o vencidos, suscripción vigente, cuenta del Jefe (si ya cambió la contraseña y su último ingreso), pagos y actividad reciente.
- CA2: Los pagos anulados aparecen marcados, con su motivo, y no suman.
- CA3: La contraseña temporal nunca aparece.

**SA-RF-08 Editar datos** — Must
- CA1: El subdominio no se puede editar; si se envía, la API responde 422.
- CA2: Si otra persona editó antes (la `version` no coincide), responde 409.
- CA3: La auditoría guarda el antes y el después.

**SA-RF-09 Cambiar estado** — Must
- CA1: Solo acepta las transiciones de §2.1; las demás responden 422.
- CA2: El modal muestra el estado actual, el de destino y la consecuencia.
- CA3: Reactivar exige el pago en la misma operación: si el pago falla, el estado no cambia.
- CA4: Suspender o cancelar exige motivo.
- CA5: Anular el pago con el que se reactivó no revierte el estado; se muestra una advertencia.

**SA-RF-10 Cancelar** — Must
- CA1: Aplica el flujo de §2.4 y guarda la fecha y el motivo.
- CA2: Un gimnasio cancelado no acepta pagos, "Entrar como" ni regeneración de credenciales.

**SA-RF-30 Exportar datos al cancelar** — Must
- CA1: Al cancelar se genera un ZIP con archivos CSV en el servidor propio, descargable mediante un enlace que vence a los 30 días.
- CA2: Un enlace vencido o ya eliminado responde 410.
- CA3: Cada descarga queda en auditoría.

**SA-RF-31 Eliminación definitiva** — Must
- CA1: Solo se habilita cuando pasaron 30 días desde la cancelación.
- CA2: Exige una confirmación explícita (por ejemplo, escribir el subdominio).
- CA3: Borra los datos del gimnasio, invalida el enlace de exportación y libera el subdominio.
- CA4: La auditoría del SA conserva el evento, sin datos del tenant.

**SA-RF-32 Bloqueo automático** — Must
- CA: los de §2.2 y §2.3.
- CA extra: el bloqueo se levanta con la primera petición posterior a un pago que deje d < 4.

### M3 · Credenciales

**SA-RF-11 Mostrar credenciales una vez** — Must
- CA1: La contraseña temporal se muestra una sola vez; al recargar ya no aparece.
- CA2: No queda en claro en la BD, en los logs, en la auditoría ni en ningún otro endpoint.
- CA3: Para salir desde la UI hay que marcar el checkbox de confirmación. Si se cierra la pestaña, la única vía es regenerar.
- CA4: "Copiar todo" genera un bloque para WhatsApp con usuario, contraseña, URL y vencimiento.
- CA5: Si el envío por correo falla, se puede reintentar mientras la pantalla siga abierta.
- CA6: La contraseña vence a las 72 h; si está vencida, el login indica que se debe contactar a MVC.
- CA7: En el primer ingreso, el Jefe debe cambiar la contraseña.

**SA-RF-12 Regenerar y enviar por correo** — Must *(absorbe el antiguo RF-13)*
- CA1: Invalida de inmediato la contraseña anterior (temporal o definitiva) y cierra las sesiones del Jefe.
- CA2: La nueva contraseña vence en 72 h, se muestra con las reglas de SA-RF-11 y se envía al correo del Jefe.

**SA-RF-29 Editar correo del Jefe** — Should
- CA1: Si el correo nuevo ya existe como usuario de ese gimnasio, se rechaza.
- CA2: Tras el cambio se exige regenerar credenciales, porque la contraseña anterior deja de servir.
- CA3: Queda en auditoría con el correo anterior y el nuevo.

### M4 · Suscripciones

**SA-RF-14 Histórico de suscripción** — Must
- CA1: Cambiar el valor mensual crea un registro nuevo con `vigencia_desde` y cierra el anterior; nunca se sobrescribe.
- CA2: El cambio no es retroactivo (§3).

**SA-RF-15 Tipo de inicio** — Must
- CA1: Prueba: 5 días, sin meses ni pago.
- CA2: Cliente activo: exige al menos 1 mes y registra el pago inicial en la misma transacción.
- CA3: Se acepta una fecha de inicio pasada, para migrar clientes.

### M5 · Cobros

**SA-RF-16 Registrar pago** — Must
- CA1: Monto > 0, meses como entero ≥ 1, `fecha_pago` ≤ hoy, método en texto libre.
- CA2: Dos envíos con la misma `Idempotency-Key` registran un solo pago.
- CA3: La fecha de corte que se ve antes de guardar coincide con la que calcula el servidor.
- CA4: Se rechaza el pago a un gimnasio cancelado. Uno suspendido solo recibe pagos mediante la reactivación (SA-RF-09).
- CA5: Si el monto ≠ valor vigente × meses, se muestra un aviso que **no** bloquea.

**SA-RF-17 Calcular fecha de corte** — Must
- CA: los de §3.

**SA-RF-18 Anular pago** — Must
- CA1: Exige motivo. El pago queda marcado como anulado y no se borra. Anularlo dos veces responde 409.
- CA2: La fecha de corte se recalcula, y con ella el estado calculado (puede quedar bloqueado).
- CA3: Los ingresos del mes se actualizan.

### M6 · Soporte

**SA-RF-19 Entrar como** — Should
- CA1: Motivo obligatorio; el token dura 1 h y solo sirve una vez para iniciar.
- CA2: Se muestra un banner permanente. La auditoría del gimnasio registra el actor real con `impersonando = true`, y el Jefe puede verlo.
- CA3: Al vencer el token, la sesión termina en la siguiente petición.
- CA4: No se permite en gimnasios cancelados.

**SA-RF-20 Finalizar soporte** — Should
- CA1: Invalida el token en servidor; reutilizarlo responde 401.

**SA-RF-28 Notas internas** — Should
- CA1: Cada nota guarda texto, autor y fecha; las notas no se editan.

### M7 · Catálogo de ejercicios

**SA-RF-21 Listar, buscar y filtrar** — Must
- CA1: Filtra por grupo muscular, equipo y estado; busca en español e inglés; muestra el total.

**SA-RF-22 Crear y editar** — Must
- CA1: Exige al menos un nombre. Se muestra el nombre en español si existe; si no, el de inglés.
- CA2: El archivo visual es una imagen (jpg, png, webp o gif) guardada en el servidor propio.
- CA3: Se registra el origen del ejercicio: importado o manual.

**SA-RF-23 Activar / desactivar** — Must
- CA1: No se borran ejercicios en v1.
- CA2: Un ejercicio desactivado a nivel global sigue apareciendo en las plantillas de los gimnasios, pero sin imagen.

**SA-RF-24 Importar dataset** — Must
- CA1: Evita duplicados usando el par (`origen`, `id_externo`).
- CA2: Re-importar actualiza los campos del dataset sin pisar los editados a mano (por ejemplo, `nombre_es`).
- CA3: Las imágenes se descargan y se guardan en el servidor propio. Si una falla, queda en el reporte de la importación y el resto continúa.
- CA4: Una importación parcial se puede reintentar sin duplicar.

### M8 · Auditoría

**SA-RF-25 Registro inmutable** — Must
- CA1: Toda escritura genera su registro en la misma transacción; si la auditoría falla, la operación falla.
- CA2: Un trigger rechaza cualquier `UPDATE` o `DELETE` sobre `auditoria`.
- CA3: La cadena `hash_previo` / `hash_actual` se puede verificar con un script.
- CA4: Nunca contiene contraseñas, tokens ni secretos.
- CA5: Guarda `actor_nombre` desnormalizado, para que sobreviva si el usuario se desactiva.

**SA-RF-26 Consulta con filtros** — Should
- CA1: Filtra por usuario, acción, gimnasio y rango de fechas; es de solo lectura.

## 5. Requisitos no funcionales

| ID | Atributo | Requisito | Verificación |
|---|---|---|---|
| SA-RNF-01 | Seguridad | App, dominio y usuario de BD separados. Contraseñas con Argon2id. Secretos nunca en claro | Test: el usuario de BD del SA solo puede leer la vista de conteos |
| SA-RNF-02 | Multi-tenancy | RLS por `gym_id`, *fail-closed* (sin tenant, no ve nada) | Test: una conexión sin tenant configurado ve 0 filas |
| SA-RNF-03 | Auditabilidad | Solo inserción; se conserva el actor real | SA-RF-25 |
| SA-RNF-04 | Integridad | Fecha de corte derivada del historial; idempotencia en pagos y altas | §3, SA-RF-16 |
| SA-RNF-05 | Usabilidad | Interfaz en español; credenciales copiables en bloque | SA-RF-11 |
| SA-RNF-06 | Rendimiento | Listados paginados; búsqueda con índice trigram | `EXPLAIN` usa el índice |
| SA-RNF-07 | Escalabilidad | De pocos a decenas de gimnasios sin rediseño | — |
| SA-RNF-08 | Tiempo | Timestamps en UTC; fechas de negocio como `DATE` en America/Bogota | Test en el cambio de día UTC (19:00 en Bogotá) |
| SA-RNF-09 | Dinero | COP como enteros | Esquema |
| SA-RNF-10 | Construcción | Las migraciones son la única fuente del esquema. Tipos TS generados desde OpenAPI. Tests contra PostgreSQL real. Smoke test del sistema combinado antes de pasar de fase | CI |
