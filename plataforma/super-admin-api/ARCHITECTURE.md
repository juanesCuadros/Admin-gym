# GymOS — Arquitectura Técnica del Backend (Super Administrador - Ola 1)

Documentación arquitectónica oficial de la primera versión del backend para el módulo de **Super Administrador de GymOS**, plataforma SaaS multi-tenant diseñada para la gestión integral de gimnasios, centros fitness y entrenadores.

---

## 1. Resumen Ejecutivo

El módulo de Super Administrador constituye el núcleo operativo interno del SaaS. Permite a los operadores de GymOS dar de alta gimnasios, supervisar su estado operativo y financiero, controlar el catálogo global de ejercicios y mantener una traza de auditoría inmutable de todas las acciones de escritura.

### Objetivos Principales:
* **Aislamiento Multi-tenant Robusto:** Separación en esquemas de PostgreSQL (`superadmin` y `platform`) con políticas de **Row-Level Security (RLS)** basadas en `tenant_id`.
* **Aprovisionamiento Asistido (Onboarding Asistido):** Flujo de alta orquestado en 4 pasos con generación segura de credenciales temporales (Argon2id) y mensaje formateado para WhatsApp.
* **Integridad Financiera (RNF-04):** La fecha de corte se calcula y deriva siempre del historial de pagos vigentes (idempotencia y recálculo automático ante anulaciones).
* **Catálogo Global Versionado:** Repositorio centralizado de ejercicios multimedia que todos los gimnasios consumen de forma unificada.
* **Auditoría Inmutable Criptográfica (RNF-03):** Encadenamiento de bloques tipo hash-chain SHA-256 en cada registro de escritura.

---

## 2. Arquitectura de Software: Clean Architecture & Hexagonal

El proyecto está diseñado bajo los principios de **Clean Architecture** (Arquitectura Limpia) y el patrón de **Puertos y Adaptadores (Arquitectura Hexagonal)**, garantizando que el núcleo de negocio sea independiente de frameworks, bases de datos y controladores web.

```
/super-admin-api
├── alembic/                         # Migraciones de esquema PostgreSQL
├── app/
│   ├── core/                        # Configuración global, seguridad, excepciones
│   │   ├── config.py                # Variables de entorno y Pydantic Settings
│   │   ├── security.py              # Argon2id, JWT HS256, hashes SHA-256
│   │   ├── exceptions.py            # Jerarquía de excepciones de dominio
│   │   └── dependencies.py          # Inyección de dependencias FastAPI
│   ├── domain/                      # Núcleo del negocio (puro, sin frameworks)
│   │   ├── services/                # Servicios de dominio:
│   │   │   ├── cutting_date_calculator.py  # Algoritmo de fecha de corte
│   │   │   └── subdomain_generator.py      # Slug y validación RFC de subdominio
│   │   └── repositories/            # Interfaces abstractas de repositorios
│   ├── application/                 # Casos de uso (Orquestación del negocio)
│   │   └── use_cases/
│   │       ├── auth_use_cases.py         # Login, bloqueo por intentos, recuperación
│   │       ├── gym_use_cases.py          # Aprovisionamiento, edición, máquina de estados
│   │       ├── payment_use_cases.py      # Pagos, anulación, histórico de suscripción
│   │       ├── credentials_use_cases.py  # Regeneración y reenvío seguro (72h)
│   │       └── exercise_use_cases.py     # Catálogo global, importación de datasets
│   ├── infrastructure/              # Implementaciones técnicas externas
│   │   ├── database/
│   │   │   ├── base.py              # Base declarativa de SQLAlchemy
│   │   │   └── session.py           # Engine, sesiones e inyección de contexto RLS
│   │   ├── models/
│   │   │   ├── superadmin_models.py # Modelos del esquema `superadmin`
│   │   │   └── platform_models.py   # Modelos del esquema `platform` (RLS)
│   │   └── repositories/            # Repositorios concretos con SQLAlchemy
│   └── presentation/                # Capa de entrada (FastAPI / HTTP)
│       ├── api/v1/
│       │   ├── endpoints/           # Controladores REST agrupados por módulo
│       │   │   ├── auth.py
│       │   │   ├── dashboard.py
│       │   │   ├── gyms.py
│       │   │   ├── credentials.py
│       │   │   ├── payments.py
│       │   │   ├── exercises.py
│       │   │   └── audit.py
│       │   └── router.py            # Agregador del enrutador v1
│       ├── middleware/              # Manejo global de errores y contexto de tenant
│       └── schemas/                 # Esquemas Pydantic v2 de entrada y salida
├── tests/                           # Suite integral de pruebas Pytest
│   ├── unit/                        # Pruebas unitarias de algoritmos
│   └── integration/                 # Pruebas de integración de endpoints REST
├── Dockerfile                       # Contenedor optimizado de producción
├── docker-compose.yml               # Orquestación con PostgreSQL 16
└── pyproject.toml                   # Dependencias y configuración de herramientas
```

---

## 3. Estrategia Multi-tenant y Modelo de Datos

Se implementa una estrategia de **Base de Datos Compartida con Esquemas Diferenciados y Aislamiento por RLS**:

### Esquema `superadmin`:
Contiene las entidades exclusivas para la gestión interna de la plataforma GymOS:
* `usuarios_internos`: Operadores del SaaS con roles (`superadmin`, `operador`).
* `intentos_login`: Registro de auditoría para mitigar ataques de fuerza bruta (bloqueo tras 5 intentos fallidos en 15 minutos).
* `gimnasios`: Registro central de gimnasios con subdominio único e inmutable, estado operativo (`prueba`, `activo`, `suspendido`, `cancelado`), fecha de inicio y fecha de corte.
* `cuentas_jefe`: Datos de contacto y estado de credenciales del dueño/administrador de cada gimnasio.
* `suscripciones`: Histórico no destructivo del valor mensual acordado y su vigencia.
* `pagos`: Registro de recaudos con `idempotency_key`, meses cubiertos y anulación auditable.
* `emisiones_credenciales`: Control de expedición y caducidad (72 horas) de contraseñas temporales.
* `auditoria`: Traza inmutable de todas las operaciones de escritura mediante encadenamiento SHA-256.

### Esquema `platform`:
Almacena los datos operativos que utilizarán los gimnasios en las siguientes olas (entrenadores, miembros, rutinas, etc.):
* `tenants`: Espejo de configuración del gimnasio.
* `staff`: Cuentas de personal (el dueño se crea inicialmente con rol `jefe`).
* `ejercicios`: Catálogo de ejercicios donde `gimnasio_id IS NULL` representa el **catálogo multimedia global**, y registros con `gimnasio_id` específico representan ejercicios personalizados del tenant.
* **Row-Level Security (RLS):**
  Las tablas del esquema `platform` tienen activada la política RLS:
  ```sql
  ALTER TABLE platform.staff ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation_policy ON platform.staff
    USING (gimnasio_id = current_setting('app.gimnasio_id', true)::uuid);
  ```
  La sesión inyecta `SET LOCAL app.gimnasio_id = '...'` de forma transparente al atender peticiones del tenant.

---

## 4. Flujo de Aprovisionamiento Asistido (Onboarding)

El alta de un gimnasio (RF-04, RF-06, RF-11, RF-15) se realiza de forma atómica:

1. **Validación de Subdominio:** Se limpia el nombre a slug RFC (ej. `"Power Gym Élite"` $\rightarrow$ `power-gym-elite`) y se verifica disponibilidad en tiempo real (RF-05).
2. **Creación de Gimnasio:** Se asigna un `UUID` compartido y se establece el estado inicial:
   * `prueba`: Se calculan automáticamente 5 días de gracia (`fecha_inicio + 5 días`).
   * `cliente_activo`: Estado activo a la espera del primer pago.
3. **Generación de Clave Temporal Segura:** Contraseña aleatoria de 12 caracteres (letras, números y caracteres especiales) hasheada con **Argon2id**.
4. **Espejo en Plataforma:** Se registra el `tenant` en `platform.tenants` y la cuenta `staff` con rol `jefe` en `platform.staff`.
5. **Emisión de Credenciales Copiables (RF-11):**
   * Se retorna un bloque consolidado en una sola vista.
   * Por seguridad, la contraseña en texto plano se retorna únicamente en la respuesta de creación.
   * Se genera el texto preformateado listo para copiar y enviar al cliente por WhatsApp.

---

## 5. Regla de Oro Financiera: Derivación de Fecha de Corte (RNF-04)

Para garantizar consistencia absoluta y eliminar discrepancias en las fechas de corte:
* **Derivación Matemática:** La `fecha_corte` nunca se modifica arbitrariamente; se calcula sumando el total de meses de todos los pagos válidos (`anulado = false`) a la fecha de inicio del gimnasio:
  $$\text{Fecha de Corte} = \text{Fecha Inicio} + \sum_{p \in \text{Pagos Activos}} \text{Meses}(p)$$
* **Anulación Idempotente (RF-18):** Al anular un pago, el sistema lo marca como `anulado = true`, exige un motivo de auditoría y **recalcula automáticamente la fecha de corte** a partir del historial remanente.
* **Prevención de Doble Pago:** Toda transacción exige una `idempotency_key` única; solicitudes duplicadas retornan `HTTP 409 Conflict`.

---

## 6. Auditoría Criptográfica Inmutable (Hash-Chain)

Para cumplir con RNF-03 y garantizar que ningún registro de auditoría pueda ser modificado o eliminado sin ser detectado:

1. Cada evento de auditoría calcula:
   $$\text{Hash Previo} = \text{Hash Actual del registro inmediatamente anterior (o } 64 \text{ ceros para el génesis)}$$
2. Se calcula el hash del nuevo bloque:
   $$\text{Hash Actual} = \text{SHA256}(\text{Hash Previo} + \text{Actor} + \text{Acción} + \text{Entidad} + \text{ID} + \text{Detalle JSON} + \text{Timestamp ISO})$$
3. **Endpoint de Verificación (`GET /api/v1/admin/audit/verify-chain`):**
   Recorre la tabla completa verificando la continuidad de la cadena. Si cualquier dato o timestamp es alterado en la base de datos, la función reporta de inmediato el ID del registro corrupto.
4. **Sanitización de Secretos:** Los datos sensibles (contraseñas, tokens) son redactados con `[REDACTED_SECURITY]` antes de generar el hash y almacenarse.

---

## 7. Catálogo Global de Ejercicios

* **Compartición Eficiente:** Los ejercicios con `gimnasio_id IS NULL` están disponibles para todos los gimnasios del SaaS.
* **Importación Masiva (RF-24):** Endpoint `/api/v1/admin/exercises/import` permite cargar datasets estándar (ej. Wger) actualizando registros existentes por nombre o ignorándolos, sin generar duplicados.
* **Versionamiento:** Cada actualización incrementa un campo `version` para facilitar la sincronización en clientes móviles y web.

---

## 8. Guía de Ejecución y Pruebas

### Ejecución con Docker:
```bash
cd super-admin-api
docker compose up --build -d
```
La API estará disponible en `http://localhost:8000`.
Documentación interactiva Swagger UI: `http://localhost:8000/docs`
Documentación Redoc: `http://localhost:8000/redoc`

### Ejecución de Pruebas Pytest:
```bash
pytest tests/ -v
```
La suite incluye pruebas unitarias de algoritmos y pruebas de integración de endpoints sobre base de datos de pruebas en memoria con esquemas aislados.
