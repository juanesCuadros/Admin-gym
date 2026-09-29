# GymOS — Matriz de trazabilidad: requisitos consolidados vs. código

Generada el 16-sep-2026 cruzando `requisitos_consolidados_superadmin.md` y
`requisitos_consolidados_sistema-web.md` (v2, con `00_decisiones-consolidacion.md`) contra el
código real de `plataforma/super-admin-api`, `producto/gym-jefe-api` e `infra/db/01_schema.sql`.

Responde una sola pregunta por requisito: **¿lo que pidió el negocio está construido?** Los casos
de prueba concretos están en `PLAN_DE_PRUEBAS.md`; aquí solo se referencian.

---

## Cómo leer

| Marca | Significado |
|---|---|
| ✅ | Construido. Falta probarlo, no construirlo |
| ⚠️ | Parcial: existe, pero le falta algún CA o difiere de la regla consolidada |
| ❌ | No construido. Los casos del plan que lo cubren darán ❌ hasta que se implemente |
| ⏸ | Postergado por decisión (`00_decisiones §3`): no se prueba en v1 |
| ❓ | No se pudo confirmar leyendo el código; hay que verificarlo ejecutando |

La columna **Evidencia** apunta a `archivo:línea` para que cualquiera pueda comprobar la marca sin
confiar en este documento.

---

## Resumen ejecutivo

| Sistema | RF Must | ✅ | ⚠️ | ❌ |
|---|---|---|---|---|
| Super-Admin (SA) | 29 | 15 | 11 | 3 |
| Sistema Web (GW) | 44 | 28 | 13 | 3 |

Los ❌ son pocos porque cuentan por RF; pero dos de ellos (SA-RF-32 y GW-RF-52) y varios ⚠️
(§2.2, §3, GW-RF-08) son los que sostienen el cobro y la caja. El peso está en la lista de abajo,
no en la suma.

**Las 7 brechas que más pesan**, en orden de daño si salen a producción:

1. **Bloqueo automático por no pago no existe** (SA-RF-32, GW-RF-51). Un gimnasio que deja de
   pagar sigue operando hasta que alguien lo suspenda a mano. Es el modelo de cobro del SaaS.
2. **La fecha de corte ignora la regla del ancla** (§3, SA-RF-17 CA5). Un pago hecho estando
   bloqueado suma sobre `fecha_inicio`, no desde el pago: el gimnasio paga un mes y recibe menos.
3. **Reactivar reactiva a todo el staff** (SA-RF-09), incluido el que el Jefe había desactivado. Un
   empleado despedido recupera acceso cuando el gimnasio vuelve a pagar.
4. **Turno de caja por persona, no por gimnasio** (GW-RF-08). Dos recepcionistas pueden tener dos
   turnos abiertos a la vez sobre la misma caja física.
5. **Regla C2 de renovación no existe** (GW-RF-25 CA2). Quien entró en gracia y renueva tarde
   recibe días que no le corresponden.
6. **Planes grupales y descuentos no existen** (GW-RF-52, GW-RF-53). Son Must y afectan caja.
7. **RLS con puerta trasera** (SA-RNF-02, GW-RNF-02). `OR current_gimnasio_id() IS NULL` en
   `01_schema.sql:1040,1051,1059,1063`: una sesión sin tenant ve todos los gimnasios.

---

## Parte A — Super-Admin (SA)

### Reglas transversales (§2 y §3)

| Regla | Estado | Evidencia / brecha | Plan |
|---|---|---|---|
| §2.1 Estados guardados y transiciones | ✅ | `gym_use_cases.py:267-275`: `prueba→activo/cancelado`, `activo→suspendido/cancelado`, `suspendido→activo/cancelado`, `cancelado→∅`. Coincide con la tabla | 13.7 |
| §2.2 Estados calculados (`al_dia`, `por_vencer`, `en_gracia`, `bloqueado`) | ❌ | No hay ninguna función que derive el estado desde `fecha_corte`. `gym_repository.py:111-119` solo cuenta `por_vencer` y `pruebas_por_vencer` para el tablero | 13.12–13.16 |
| §2.3 Efecto del bloqueo en GW | ⚠️ | Solo existe `platform.tenant.activo` (booleano manual). El producto lo revisa en `dependencies.py:83` y `auth/service.py:171,292` con `GIMNASIO_SUSPENDIDO`. No hay bloqueo por fecha ni pantalla de "servicio bloqueado" con contacto | 15.1–15.6 |
| §2.4 Flujo de cancelación (export 30 días, eliminación manual, liberar subdominio) | ❌ | `cancel_gym` (`gym_use_cases.py:315`) solo cambia estado y congela. No hay exportación, ni contador de 30 días, ni eliminación, ni liberación de subdominio | 13.19–13.22 |
| §3 Fecha de corte con ancla y suma en un paso | ⚠️ | `cutting_date_calculator.py:20-43`: `add_months(fecha_inicio, Σ meses)` con ajuste a fin de mes ✅ (CA1, CA2, CA3, CA6). **Sin regla del ancla**: un pago en bloqueado/suspendido suma sobre `fecha_inicio` (❌ CA5). CA4 pasa por accidente (sin ancla nueva, suma sobre el corte) | 14.10–14.15 |
| §3 Valor mensual no retroactivo | ✅ | `payments.py:105` crea registro nuevo en `superadmin.suscripciones` | 13.11 |

### M0 · Autenticación

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| SA-RF-00.1 Iniciar sesión | Must | ⚠️ | Login con Argon2id ✅ (`security.py:6`), mensaje genérico ✅ (`auth_use_cases.py:30-36`). **Sesión por JWT Bearer, no cookie `HttpOnly/Secure/SameSite=Strict`** (`security.py:38-54`). CA1 no se cumple como está escrito | 13.23 |
| SA-RF-00.2 Recuperar contraseña | Must | ⚠️ | Respuesta idéntica ✅ (`auth_use_cases.py:62-65`). **Token vence a 2 h, el requisito dice 1 h** (`auth_use_cases.py:70`). ❓ CA3 cierra todas las sesiones | 13.24 |
| SA-RF-00.3 Cerrar sesión / expiración | Must | ✅ | Logout invalida en servidor vía `TokenInvalido` (`auth_use_cases.py:129`). Expiración fija 60 min (`config.py:27`) — es por vida del token, no por inactividad; aceptable | 13.25 |
| SA-RF-00.4 Bloqueo por intentos | Must | ⚠️ | 5 intentos / 15 min ✅ (`config.py:31-32`). **Devuelve 423 con mensaje "Cuenta temporalmente bloqueada…"** (`exceptions.py:27-31`): revela el bloqueo, CA1 exige el mensaje genérico | 13.26 |

### M1 · Inicio

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| SA-RF-01 Métricas | Must | ⚠️ | Tablero existe (`dashboard.py:12`). Faltan `en_gracia`, `bloqueados` y "listos para eliminar" (dependen de §2.2 y §2.4). ❓ CA4 vista de conteos con permiso de solo lectura | 13.1 |
| SA-RF-02 Tabla de urgencia | Must | ⚠️ | Orden existe (`gyms.py:40`) pero sin los estados calculados; el orden pedido (bloqueados → gracia → pruebas → por vencer) no se puede cumplir sin §2.2 | 13.2 |

### M2 · Gimnasios

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| SA-RF-03 Listar | Must | ✅ | `gyms.py:40`. ❓ búsqueda sin tildes (CA1) e índice trigram (RNF-06) | 13.27 |
| SA-RF-04 Crear (4 pasos) | Must | ⚠️ | Creación ✅ (`gyms.py:89`), galería en `superadmin.gimnasio_galeria`. **Sin `Idempotency-Key` en el alta** (solo en pagos): CA2 y CA3 no se cumplen; el doble clic depende del UNIQUE de subdominio | 13.3, 13.28 |
| SA-RF-05 Subdominio | Must | ⚠️ | Slug sin tildes ✅ (`subdomain_generator.py:10-18`). **Regex 3–50, no 3–63** (`:7`). **Sin palabras reservadas** (`admin`, `www`, `api`, `app`, `mail`): CA3 ❌. UNIQUE en BD ✅ (`01_schema.sql:295`) | 13.4, 13.29–13.31 |
| SA-RF-06 Provisioning | Must | ✅ | Una transacción con `provisioning_pasos` (`gym_use_cases.py:52-160`); parámetros iniciales `dias_gracia_mora=3` (`:134`); métodos de pago por defecto ❓ | 13.3 |
| SA-RF-07 Ficha | Must | ✅ | `gyms.py:119` | 13.6 |
| SA-RF-08 Editar | Must | ✅ | `gyms.py:238`; `gimnasios.version` existe. ❓ 422 si envían subdominio; ❓ 409 por `version` | 13.5, 13.32 |
| SA-RF-09 Cambiar estado | Must | ⚠️ | Transiciones ✅. **Reactivar no exige pago** (CA3 ❌). **Motivo solo obligatorio en cancelar**, no en suspender (`gym_use_cases.py:277`; CA4 parcial). **Bug: reactivar pone `activo=true` a todo el staff** (`:293-298`), pisando desactivaciones del Jefe | 13.7, 13.33–13.35 |
| SA-RF-10 Cancelar | Must | ⚠️ | Estado + motivo + fecha ✅. CA2 (rechazar pagos/credenciales en cancelado) ❓ | 13.8, 13.36 |
| SA-RF-30 Exportar al cancelar | Must | ❌ | No existe endpoint ni tabla de enlaces | 13.19 |
| SA-RF-31 Eliminación definitiva | Must | ❌ | No existe. `gimnasios.deleted_at` es soft-delete sin flujo | 13.20–13.22 |
| SA-RF-32 Bloqueo automático | Must | ❌ | Ver §2.2 | 13.12–13.16 |

### M3 · Credenciales

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| SA-RF-11 Mostrar una vez | Must | ⚠️ | `emisiones_credenciales` + 72 h ✅ (`config.py:52`). **CA7 (cambio obligatorio en el primer ingreso) no existe en el producto**: `auth/service.py` no tiene ninguna bandera de "debe cambiar" | 13.9, 13.37 |
| SA-RF-12 Regenerar y enviar | Must | ✅ | `credentials.py:12`. El antiguo `/resend` (`:25`) sigue existiendo aunque el RF-13 se fusionó: hay que retirarlo o dejarlo documentado | 13.9 |
| SA-RF-29 Editar correo del Jefe | Should | ❌ | No hay endpoint | 13.38 |

### M4 · Suscripciones · M5 · Cobros

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| SA-RF-14 Histórico de suscripción | Must | ✅ | `payments.py:105` | 13.11 |
| SA-RF-15 Tipo de inicio | Must | ✅ | `gym_use_cases.py:75-77`; `DEFAULT_TRIAL_DAYS=5` | 13.3 |
| SA-RF-16 Registrar pago | Must | ✅ | Idempotencia ✅ (`payment_use_cases.py:60-63`, `pagos.idempotency_key UNIQUE`). ❓ CA4 rechazo en cancelado; ❓ CA5 aviso de monto | 14.1, 14.3, 14.16 |
| SA-RF-17 Calcular corte | Must | ⚠️ | Ver §3 | 14.10–14.15 |
| SA-RF-18 Anular pago | Must | ✅ | `payments.py:75`; ❓ 409 al anular dos veces | 14.2, 14.17 |

### M6 · Soporte

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| SA-RF-19 Entrar como | Should | ❌ | La tabla `superadmin.sesiones_soporte` (`01_schema.sql:204`) y la columna `auditoria.impersonando` existen, **sin ningún endpoint** | 13.39 |
| SA-RF-20 Finalizar soporte | Should | ❌ | Ídem | 13.39 |
| SA-RF-28 Notas internas | Should | ❌ | Tabla `superadmin.notas_gimnasio` (`:143`) sin endpoint | 13.40 |

### M7 · Catálogo · M8 · Auditoría

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| SA-RF-21 Listar/buscar/filtrar | Must | ✅ | `exercises.py:17` | 14.4 |
| SA-RF-22 Crear y editar | Must | ✅ | `exercises.py:59,86`. ❓ imagen en servidor propio | 14.4 |
| SA-RF-23 Activar/desactivar | Must | ✅ | `exercises.py:114`; no hay DELETE | 14.5 |
| SA-RF-24 Importar dataset | Must | ✅ | `exercises.py:142`, `importaciones_ejercicios`. ❓ CA2 no pisar `nombre_es`; ❓ CA3 reporte de imágenes fallidas | 14.6, 14.18 |
| SA-RF-25 Registro inmutable | Must | ✅ | **Trigger append-only sí existe**: `01_schema.sql:276-280` (`tg_auditoria_no_update`). Cadena hash + `/verify-chain` (`audit.py:68`). `actor_nombre` desnormalizado ✅ | 14.7, 14.8 |
| SA-RF-26 Consulta con filtros | Should | ✅ | `audit.py:16` | 14.19 |

### RNF del SA

| RNF | Estado | Evidencia / brecha |
|---|---|---|
| SA-RNF-01 Seguridad (app, dominio y usuario de BD separados) | ❓ | Argon2id ✅. Hay que verificar en `infra/docker-compose*.yml` que el SA usa un usuario de BD distinto y que solo lee la vista de conteos |
| SA-RNF-02 RLS fail-closed | ❌ | `01_schema.sql:1040,1051,1059,1063` — puerta trasera `IS NULL` |
| SA-RNF-06 Trigram | ❓ | Buscar `pg_trgm` en el esquema |
| SA-RNF-08 Fechas Bogotá | ✅ | `fecha_corte` es `DATE`; timestamps `timestamptz` |
| SA-RNF-10 Migraciones única fuente | ⚠️ | `01_schema.sql` es la fuente, pero no hay runner de migraciones |

---

## Parte B — Sistema Web (GW)

### Módulo 00 · Reglas transversales

| Regla | Estado | Evidencia / brecha | Plan |
|---|---|---|---|
| Estado del deportista (8 estados, orden de precedencia) | ✅ | `membresias/domain.py:36-151` evalúa en el mismo orden. **Nombres distintos a los consolidados**: `inactivo`→`desactivado`, `cancelada`→`cancelado`, `mora`→`en_gracia` (P-22, decisión 9). Es un rename, no una regla | Bloque 2 |
| `venc` derivado de pagos + días congelados | ⚠️ | `fecha_vencimiento` es columna en `membresias` que se **muta** al pagar/anular/descongelar. No se recalcula desde el historial (GW-RF-16 CA1) | 3.10, 4.9 |
| GW-RF-51 Estado de la suscripción del gimnasio | ⚠️ | Solo `tenant.activo` manual. Sin contador (CA1), sin gracia (CA2), sin bloqueo por corte ni prueba vencida (CA3). CA4 turno abierto ❓ | 15.1–15.6 |

### Módulo 01 · Autenticación

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| GW-RF-00.1 Login access + refresh | Must | ⚠️ | Access + refresh ✅ (`auth/service.py:237-256`). **Refresh no rota** (`:269-300` solo valida el hash) y no hay familia de tokens: CA1 ❌. Subdominio ✅ (`:160-171`). **Primer ingreso obligatorio ❌** (CA3). CA4 recepcionista sin turno ❓ (probablemente no) | 1.1–1.8, 1.13, 1.14 |
| GW-RF-00.2 Recuperar | Must | ✅ | `tokens_recuperacion_staff` | 1.9, 1.10 |
| GW-RF-00.3 Logout / expiración | Must | ⚠️ | Logout ✅. **Expiración fija 30 min** (`config.py:25`); el parámetro por gimnasio no existe | 1.8 |
| GW-RF-00.4 Bloqueo por intentos | Should | ⚠️ | 5/15 ✅. Mensaje `CUENTA_BLOQUEADA_TEMPORALMENTE` (`auth/service.py:191`) no es genérico | 1.5 |

### Módulo 02 · MyGymOS

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| GW-RF-45 Información general | Must | ✅ | `my_gym/` con auditoría y OCC | 11.1 |
| GW-RF-46 Mi landing | Should | ✅ | QR SVG/PNG (`my_gym/`). ❓ edición de contenido dentro de plantilla | 11.5 |
| GW-RF-47 Métodos de pago | Must | ✅ | `tenant.metodos_pago jsonb` | 11.9 |
| GW-RF-48 Parámetros | Must | ⚠️ | Existen 3 de 9: `dias_gracia_mora`, `dias_umbral_por_vencer`, `tope_dias_congelamiento` (`01_schema.sql:297-299`). **Faltan**: mínimo congelamiento, permitir descuentos, tope %, duración de sesión, ventana de reserva, límite para cancelar | 11.2, 11.3, 11.10 |

### Módulo 03 · Personal

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| GW-RF-00.5 Matriz de permisos | Must | ✅ | `permisos_rol`; 404 cross-tenant ✅ | 1.11, 1.12, 0.1 |
| GW-RF-39 Staff | Must | ⚠️ | El Jefe crea con contraseña que él escribe (`personal/service.py:141`). **No hay credencial temporal 72 h ni cambio obligatorio** (CA1 ❌). Correo único ✅. CA4 turno abierto ❓ | 9.1–9.5, 9.9, 9.10 |
| GW-RF-40 Jefe único | Must | ✅ | Transferencia atómica (`personal/service.py:514`). ❓ CA2 constraint en BD (no se ve índice parcial de un solo jefe en `01_schema.sql`) | 9.6–9.8 |

### Módulo 04 · Planes · 05 · Inventario

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| GW-RF-24 Planes | Must | ⚠️ | `planes.cupo_personas` puede servir como "beneficiarios". **Sin copia del plan en la venta**: `membresias` no guarda precio ni duración (CA2 ❌). Desactivar ✅ | 4.1–4.3, 4.15 |
| GW-RF-36 Productos | Must | ✅ | `inventario/` | 8.1, 8.2 |
| GW-RF-37 Stock | Must | ✅ | `stock_movimientos`. ❓ CA2 negativo | 8.3, 8.5 |
| GW-RF-38 Descuento en venta | Must | ✅ | `FOR UPDATE` en `caja/service.py:341` | 3.4, 3.5, 8.7 |

### Módulo 06 · Deportistas

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| GW-RF-17 Registro | Must | ⚠️ | Documento único por gimnasio ✅. Visitante: existe ítem `pase_dia` en caja (`caja/schemas.py:46`) pero ❓ registro mínimo. Menor: solo `acudiente_nombre` (`deportistas/schemas.py:25`), **sin autorización del acudiente** (CA4 parcial) | 5.1–5.4, 5.11, 5.12 |
| GW-RF-19 Consentimiento | Must | ⚠️ | `consentimiento_1581` + `consentimiento_fecha` con CHECK ✅ (`01_schema.sql:379+`). **Sin versión del texto ni quién lo registró** (CA2 parcial) | 5.13 |
| GW-RF-20 Ficha | Must | ✅ | | 5.7 |
| GW-RF-21 Mediciones | Must | ✅ | `mediciones_corporales` | 5.7 |
| GW-RF-23 Supresión | Should | ✅ | `SUPRESION_DATOS_LEY_1581`. CA3 (titular de paquete) depende de GW-RF-52 | 5.8, 5.9 |
| GW-RF-01/02/22 Huella | — | ⏸ | Construido (`huellas`, 7 archivos) pero postergado a fase escritorio. No se prueba en v1 | — |

### Módulo 07 · Membresías

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| GW-RF-25 Asignar/renovar/cambiar/cancelar | Must | ⚠️ | Renovar vigente suma desde `venc` ✅ (`caja/service.py:725`). **Regla C2 ❌**: vencida cuenta desde `hoy` sin mirar check-ins en gracia (`:722-723`). Cambio de plan ✅ (`CAMBIO_DE_PLAN`), ❓ "empieza cuando termina el actual". Cancelación ✅ | 3.9, 4.4, 4.5, 4.10–4.14 |
| GW-RF-26 Congelar | Must | ⚠️ | Congelar/descongelar con extensión ✅. Tope ✅. **Mínimo de días ❌** (no hay parámetro). ❓ CA1 solo `activo`/`por_vencer` | 4.6–4.9, 4.16 |
| GW-RF-27 Estado calculado | Must | ✅ | Sin columna de estado ✅ | Bloque 2 |
| GW-RF-52 Planes grupales | Must | ❌ | No hay `paquete_id` en `membresias`, ni titular, ni venta múltiple. Cero ocurrencias de "paquete" en el producto | 4.17–4.24 |

### Módulo 08 · Caja

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| GW-RF-08 Abrir turno | Must | ❌ | **Unicidad por staff, no por gimnasio**: `ux_turno_abierto_por_staff` (`01_schema.sql:534`) y `caja/service.py:54`. Turno ajeno: existe `cerrar_turno_forzado` del Jefe (`:206`), no el cierre por la siguiente recepcionista con atribución del descuadre | 3.1, 3.2, 3.17, 3.18 |
| GW-RF-09 Exigir turno | Must | ✅ | 409 `NO_HAY_TURNO_ABIERTO` desde la API (`:319`) | 3.3 |
| GW-RF-10 Cerrar turno | Must | ⚠️ | Esperado/contado/diferencia ✅ (`_calcular_acumulados_turno`). Inmutable ✅. ❓ CA2 marca "para revisión" + nota del Jefe | 3.12–3.14, 3.19 |
| GW-RF-11 POS atómico + idempotente | Must | ✅ | `X-Idempotency-Key` (`caja/router.py:162`), savepoint | 3.4, 3.20 |
| GW-RF-12 Anular venta | Must | ✅ | Reverso al turno abierto actual (`:530-541`, `devoluciones.turno_devolucion_id`) ✅ | 3.7, 3.8, 3.21 |
| GW-RF-13 Movimientos | Must | ✅ | `:954` | 3.22 |
| GW-RF-14 Egresos y vales | Must | ✅ | `:888`. ❓ negativo permitido | 3.11 |
| GW-RF-15 Pago de membresía | Must | ✅ | Cambio ✅, `PAGO_INSUFICIENTE` ✅ (`:729-735`) | 3.6, 3.9 |
| GW-RF-16 Anular pago | Must | ⚠️ | Reverso al turno actual ✅. **Resta `dias_agregados` en vez de recalcular desde el historial** (`:841-842`): si hubo congelamiento entre medio, el resultado difiere | 3.10 |
| GW-RF-53 Descuentos | Must | ❌ | Cero ocurrencias de `precio_lista`/`descuento` como regla; `ventas` no tiene columnas de descuento | 3.23–3.26 |

### Módulo 09 · Control de ingreso

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| GW-RF-03 Check-in manual | Must | ✅ | `control_ingreso/service.py`; registra `abrio`/`alerta_mora`/`negado` | 2.16, 2.18 |
| GW-RF-04 Regla de acceso | Must | ✅ | Usa `evaluar_estado_puro` | 2.1–2.15 |
| GW-RF-05 Cortesía | Must | ✅ | `motivo_cortesia` en `checkins` | 2.19, 2.20 |
| GW-RF-06 Ingresos del día | Should | ✅ | | 2.21 |
| GW-RF-07 Pantalla TV | Must | ✅ | `pantalla_tv/` con WebSocket. ❓ nunca muestra denegados; ❓ reconexión | 12.4, 2.23 |

### Módulo 10 · Entrenamiento · 11 · Clases

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| GW-RF-28 Ejercicios | Must | ✅ | Catálogo híbrido + `gimnasio_ejercicio` | 7.1–7.3 |
| GW-RF-29 Plantillas | Must | ✅ | | 7.4, 7.5 |
| GW-RF-30 Rutinas (copia congelada) | Must | ✅ | `rutina_asignada_items` | 7.6, 7.7 |
| GW-RF-32 Programación | Must | ✅ | Recurrencia, `omitir_festivos` (`core/holidays_colombia.py`), "solo esta / serie", `CUPO_MENOR_A_RESERVAS` (`clases/service.py:262`), `profesor_externo` | 6.1, 6.2, 6.15–6.17 |
| GW-RF-33 Reservas | Must | ⚠️ | Cupo con `FOR UPDATE` ✅ (`:385`). `CUPO_AGOTADO`. **Sin ventana de reserva ni límite de cancelación** (parámetros no existen). ❓ CA2 fecha posterior al vencimiento | 6.3–6.8, 6.13, 6.14 |
| GW-RF-34 Asistencia | Must | ✅ | `SIN_CHECKIN_PREVIO` | 6.9, 6.10 |
| GW-RF-35 Lista de espera | Could | ❌ | No construido; es Could | — |

### Módulo 12 · Reportes · 13 · Auditoría

| RF | Prio | Estado | Evidencia / brecha | Plan |
|---|---|---|---|---|
| GW-RF-41 Ingresos | Must | ⚠️ | Reporte ✅. **Sin precio de lista vs cobrado** (depende de GW-RF-53). Paquete cuenta una vez (depende de GW-RF-52) | 10.1 |
| GW-RF-42 Membresías | Must | ✅ | ❓ contacto del titular (GW-RF-52) | 10.8 |
| GW-RF-43 Asistencia | Should | ✅ | ❓ "sin asistencia N días" | 10.6 |
| GW-RF-44 Exportar | Should | ✅ | CSV/Excel en memoria. ❓ BOM UTF-8 | 10.2 |
| GW-RF-49 Registro inmutable | Must | ✅ | **Trigger sí existe**: `01_schema.sql:832-836` (`tg_audgym_no_update`). Hash chain en `core/audit.py` | 11.6–11.8 |
| GW-RF-50 Consulta | Should | ✅ | | 11.6 |

### RNF del GW

| RNF | Estado | Evidencia / brecha |
|---|---|---|
| GW-RNF-02 RLS fail-closed | ❌ | Misma puerta trasera que SA-RNF-02 |
| GW-RNF-03 Idempotencia en todo lo de dinero | ✅ | Ventas y pagos de membresía. Egresos ❓ |
| GW-RNF-07 Zona horaria | ✅ | `today_local()`; probar el caso 2.21 de noche |
| GW-RNF-11 Migraciones / tipos TS / tests contra Postgres | ⚠️ | Suite del producto no es pytest (ver deuda del plan) |

---

## Correcciones al plan de pruebas v1 (15-sep)

Cosas que el plan anterior afirmaba y que este cruce desmiente o cambia:

| Plan v1 decía | Realidad | Qué cambia |
|---|---|---|
| "La auditoría no es inmutable en base: falta `REVOKE`" (caso 11.8) | Hay triggers `BEFORE UPDATE OR DELETE` que lanzan excepción en las dos tablas | El caso 11.8 pasa a 🟢 esperado; se retira de la deuda |
| Prefijos `PLAT-` / `PROD-` | Los requisitos consolidados fijan `SA-` / `GW-` (decisión 8) | Se adoptan `SA-`/`GW-` en el plan v2 y hay que llevarlos al código |
| Casos de huella 2.17, 5.5, 5.6, 5.9 | Huella postergada a fase escritorio | Se retiran del plan; quedan como ⏸ |
| Caso 14.9 roles `superadmin`/`admin`/`soporte` | El SA tiene rol único (decisión 3) | Se reemplaza por "usuarios del tenant no entran al SA" |
| Caso 13.10 "reenviar credenciales" (RF-13) | RF-13 se fusionó en SA-RF-12 | Se retira; el endpoint `/resend` debería retirarse del código |
| Estado `mora` | Se llama `en_gracia` (decisión 9) | Rename pendiente en código; el plan v2 usa el nombre consolidado y anota el actual |
| "Cierre forzado por el jefe" (3.15) como flujo correcto | La regla es un turno por gimnasio y cierre por la siguiente recepcionista (P-11, GW-RF-08) | 3.15 se marca como comportamiento actual que **no** cumple el requisito |

---

## Lo que hay que construir antes de que el plan pueda pasar completo

Ordenado por lo que desbloquea más casos, no por tamaño:

| # | Trabajo | RF que destraba | Casos del plan |
|---|---|---|---|
| 1 | Estado calculado del gimnasio desde `fecha_corte` + bloqueo automático en `dependencies.py` del producto (una función pura como `evaluar_estado_puro`, pero para el gimnasio) | SA-RF-32, SA-RF-01, SA-RF-02, GW-RF-51 | 13.12–13.16, 15.1–15.6 |
| 2 | Regla del ancla en `CuttingDateCalculator` (recibir el historial completo con fechas, no solo la lista de meses) | SA-RF-17 CA5, §3 | 14.10–14.15 |
| 3 | Reactivar con pago obligatorio y sin pisar el `activo` de cada staff (guardar el estado previo o solo re-activar los que estaban activos al suspender) | SA-RF-09 | 13.33–13.35 |
| 4 | Turno único por gimnasio: cambiar `ux_turno_abierto_por_staff` → `(gimnasio_id) WHERE estado='abierto'`; cierre de turno ajeno con atribución | GW-RF-08 | 3.17, 3.18 |
| 5 | Regla C2 en `registrar_pago_membresia` (consultar `checkins` en `[venc+1, venc+g]`) | GW-RF-25 CA2 | 4.12–4.14 |
| 6 | Planes grupales: `paquetes` + `membresias.paquete_id` + titular + venta N | GW-RF-52 | 4.17–4.24 |
| 7 | Descuentos: columnas `precio_lista`/`precio_cobrado`/`motivo_descuento` + 3 parámetros del tenant | GW-RF-53, GW-RF-48, GW-RF-41 | 3.23–3.26 |
| 8 | Cerrar la puerta trasera de RLS (quitar los `OR … IS NULL`; los jobs usan un rol con `BYPASSRLS`) | SA/GW-RNF-02 | 0.4 |
| 9 | Exportación ZIP + enlace 30 días + eliminación definitiva + liberar subdominio | SA-RF-30, SA-RF-31, §2.4 | 13.19–13.22 |
| 10 | Rotación de refresh con familia; cambio obligatorio en primer ingreso (SA y staff) | GW-RF-00.1, SA-RF-11 CA7, GW-RF-39 | 1.13, 1.14, 9.10 |
| 11 | Parámetros faltantes del tenant (6) y su uso en congelar/reservar/sesión | GW-RF-48, GW-RF-26, GW-RF-33 | 11.10, 4.16, 6.14 |
| 12 | Cookie de sesión en el SA; mensaje genérico en bloqueo; token de recuperación a 1 h; subdominio 63 y reservados | SA-RF-00.x, SA-RF-05 | 13.23–13.31 |
| 13 | "Entrar como", notas internas, editar correo del Jefe (los tres son Should) | SA-RF-19/20/28/29 | 13.38–13.40 |
