# GymOS — Monorepo

Sistema integral SaaS multi-tenant para la gestión, control y operación de gimnasios y centros de entrenamiento.

## Estructura del Proyecto

```text
gymos/
├── producto/                 # Aplicación operativa para gimnasios (Gym Tenant)
│   ├── gym-jefe-api/         # Backend asíncrono (FastAPI + asyncpg + WebSockets)
│   └── gym-jefe-web/         # Frontend SPA (React 19 + Vite + Vanilla CSS / Branding)
│
├── plataforma/               # Panel de gobernanza global (Super Admin)
│   ├── super-admin-api/      # Backend sincrónico (FastAPI + psycopg2)
│   └── super-admin-vista/    # Frontend SPA (React 19 + Vite + Apple HIG Tokens)
│
├── infra/                    # Infraestructura, Docker y Base de Datos (ÚNICA fuente de verdad)
│   ├── db/
│   │   ├── 01_schema.sql     # Esquema canónico DDL (superadmin + platform con RLS)
│   │   └── 02_arranque.sh    # Inicialización de roles, passwords, tokens y permisos RLS
│   ├── nginx/
│   │   └── nginx.conf        # Configuración de reverse proxy para producción VPS
│   ├── docker-compose.yml    # Composición para despliegue en producción (VPS)
│   ├── docker-compose.dev.yml# Composición para desarrollo local
│   ├── .env.example          # Plantilla consolidada de variables de entorno
│   └── README.md             # Guía de infraestructura
│
├── docs/                     # Especificaciones, guías de despliegue y auditorías
│   ├── AUDITORIA-ESTADO.md   # Registro de auditoría del estado y migración
│   ├── DEPLOYMENT_VPS.md     # Guía técnica de despliegue en VPS
│   ├── INVENTARIO_ENDPOINTS.md
│   └── apple-hig-design-principles.md
│
└── ORGANIZACION-REPO.md      # Especificación rectora de arquitectura y organización
```

## Desarrollo Local

Para levantar el entorno completo de desarrollo con una base de datos PostgreSQL 16 y los 4 servicios:

```bash
cd infra
docker compose -f docker-compose.dev.yml up -d --build
```

### Puertos de Acceso en Desarrollo:
- **Super Admin Frontend**: [http://localhost:3001](http://localhost:3001)
- **Super Admin API Docs**: [http://localhost:8002/docs](http://localhost:8002/docs)
- **Gym Tenant Frontend**: [http://powergym.localhost:3000](http://powergym.localhost:3000)
- **Gym Tenant API Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **PostgreSQL**: `localhost:5433` (Base: `gymos_db`)
