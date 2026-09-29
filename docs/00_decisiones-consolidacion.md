# GymOS — Registro de decisiones de la consolidación

Trazabilidad de lo decidido al consolidar los requisitos del **Super-Admin (SA)** y del **Sistema Web del Gimnasio (GW)**.
Documentos resultantes: `requisitos_consolidados_superadmin.md` · `requisitos_consolidados_sistema-web.md`.

---

## 1. Contradicciones resueltas entre documentos

| # | Resolución |
|---|---|
| 1 | Anular un pago **recalcula** la fecha de corte desde el historial; nunca se restaura un valor anterior |
| 2 | Estados guardados del gimnasio: `prueba`, `activo`, `suspendido`, `cancelado`. Por vencer, en gracia y bloqueado son **calculados** |
| 3 | SA con rol único. Salen del alcance la pantalla Equipo y el MFA |
| 4 | Sin outbox, jobs, webhooks ni n8n |
| 5 | Catálogo `free-exercise-db`: Unlicense (dominio público), 800+ ejercicios, 2 imágenes JPG por ejercicio, solo en inglés. Se dice "imagen", no "GIF" |
| 6 | La Pantalla TV es un modo de visualización de Control de ingreso |
| 7 | "Ola" solo se usa para el orden de construcción entre sistemas; en los requisitos se usa Must/Should/Could |
| 8 | IDs con prefijo `SA-` / `GW-`. GW se organiza con los módulos 00–13 de `vistas_00` |
| 9 | Mora del deportista = `en_gracia` (abre con alerta). Fuera de la gracia = `vencido` |
| 10 | El Jefe crea el staff desde pantalla |
| 11 | RF-13 (reenviar credenciales) era imposible porque la contraseña no se guarda: se fusiona en "Regenerar y enviar por correo" |

## 2. Decisiones tomadas

| ID | Tema | Decisión |
|---|---|---|
| P-01 | Efecto del estado del gimnasio | Aviso con contador desde 5 días antes del corte. Funciona con aviso los días 1–3 después del corte. **Desde el día 4 queda todo bloqueado.** Prueba vencida: bloqueo inmediato |
| P-01 / P-09 | Cancelación | Bloqueo inmediato → enlace de exportación válido 30 días → eliminación definitiva **manual** (el SA avisa "listo para eliminar") → se libera el subdominio. Si vuelve, entra como cliente nuevo y firma contrato |
| P-02 | Bloqueo por no pago | Automático y **calculado** (sin procesos programados). La suspensión manual se mantiene |
| P-02 | Pago del gimnasio en gracia o bloqueado | En gracia, el periodo continúa desde la fecha de corte. Bloqueado o suspendido, el ancla pasa a ser la fecha del pago |
| B | Prueba | 5 días |
| P-03 / G | Acceso del Jefe | "Olvidé mi contraseña" en GW. El SA regenera credenciales y puede editar el correo del Jefe (cambio de dueño) |
| P-04 | Métricas cruzadas en el SA | Vista con solo conteos por gimnasio y permiso de lectura únicamente sobre esa vista |
| P-05 | Exportación | Enlace de descarga desde servidor propio |
| P-06 | Landing | El Jefe edita el contenido desde GymOS; MVC mantiene la plantilla |
| P-08 | Prueba → activo | La fecha de corte se ancla en la fecha del pago |
| P-10 | Renovación vencida (**C2**) | Si hizo check-in en algún día de gracia, el nuevo periodo cuenta desde el vencimiento; si no, desde el día de la renovación |
| P-11 | Turno cerrado | Es inmutable; los reversos van al turno abierto |
| P-12 | Recepción | Por ahora son vistas web. Huella, torniquete y modo sin internet quedan para la fase de escritorio |
| P-13 | Cajas | Un solo turno abierto por gimnasio |
| P-14 | Planes grupales | Modelo B: un pago crea N membresías individuales. Titular = pagador, mayor de edad y beneficiario. No se vende incompleto ni se cambian beneficiarios (ver GW-RF-52) |
| P-15 | Visitantes y menores | Registro mínimo con consentimiento. Menores: datos y autorización del acudiente |
| P-16 | Valores técnicos | Sesión 1 h (configurable por gimnasio entre 15 min y 8 h; en el SA fija). 5 intentos de login con bloqueo de 15 min. Enlace de recuperación 1 h. Credenciales temporales 72 h. "Por vencer" = 5 días en SA y GW |
| P-17 | Reservas | No se puede reservar una clase con fecha posterior al vencimiento |
| P-18 | Descuentos | Permitidos: precio editable con permiso, motivo, auditoría y tope en % configurable |
| P-19 | Facturación electrónica | No entra en v1; se evalúa si un gimnasio la pide |
| P-20 | Cambio y cancelación de plan (deportista) | El plan nuevo empieza cuando termina el actual. La cancelación es inmediata, sin reembolso, y la controla la matriz de permisos |
| P-21 | Clase cancelada con pases pagados | Recepción anula la venta |
| P-22 | "Inactivo" | Se separa en `desactivado` (estado del registro) y "sin asistencia N días" (métrica de reporte) |
| P-23 | Idioma del catálogo | Nombre en español opcional con respaldo en inglés; traducción progresiva |
| P-24 | Numeración | Módulos 00–13 de `vistas_00` |
| P-26 | Congelamiento | Solo membresías vigentes. Mínimo y tope de días configurables por gimnasio |
| F | Parámetros por gimnasio | Días de gracia · días "por vencer" · mínimo y tope de congelamiento · permitir descuentos y tope en % · duración de sesión · ventana de reserva · límite para cancelar reserva |

Todos los supuestos S-xx y SW-xx de la revisión quedaron aceptados e integrados como reglas, salvo S-01, SW-02, SW-07 y SW-09, que se eliminaron. SW-21 se reemplazó por la regla de turno ajeno de `vistas_00`.

## 3. Postergados

| Tema | Motivo |
|---|---|
| Fase escritorio (Electron): huella, torniquete, modo sin internet | Foco en el sistema web |
| P-25: recierre del torniquete y salida con huella | Depende del hardware |
| App móvil: activación por invitación, login con correo repetido, alineación de mediciones con la v4 | La app es un documento académico por ahora |
| Contratos de servicio y de tratamiento de datos (Ley 1581) | Legal; validar con abogado |
| Aviso de vencimiento por correo | Requiere proceso programado y servidor de correo |
| Máximo de reservas activas por deportista e ingresos por día por deportista | Parámetros para después |

## 4. Abiertos menores (no bloquean el desarrollo)

| Tema | Pendiente |
|---|---|
| Parámetros por gimnasio | Valores iniciales con los que se crea cada gimnasio en el provisioning |
| Exportación al cancelar | Lista exacta de datos incluidos (propuesta: deportistas, membresías, pagos, asistencia) |

## 5. Interpretaciones a verificar

| Tema | Cómo quedó escrito |
|---|---|
| "Se le bloquea todo" | Bloquea el sistema web para todos los roles **y la landing pública** |
| Suspensión manual | Tiene el mismo efecto que el bloqueo por no pago |
| "No se permita cambiar" (P-14) | Se refiere a cambiar **beneficiarios**, no a cambiar de plan |
