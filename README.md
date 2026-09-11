# Admin-gym

Plataforma operativa y de administración para gimnasios (**GymOS**).

## Módulos del Sistema
- **`gym-jefe-api/`**: Backend FastAPI para la plataforma multi-tenant con Row-Level Security (RLS) en PostgreSQL.
- **`gymos_schema.sql`**: Esquema DDL de base de datos PostgreSQL con RLS para aislamiento por gimnasio.
- **`GymOS_SistemaWeb_Requisitos_v1.docx`**: Especificación de requerimientos del Sistema Web del Gimnasio.

## Requisitos y Configuración del Backend
1. Python 3.11+
2. PostgreSQL 15+ con extensiones `pgcrypto`, `citext`, `pg_trgm`
3. Configurar variables de entorno copiando `.env.example` a `.env` dentro de `gym-jefe-api/`
4. Instalar dependencias:
   ```bash
   cd gym-jefe-api
   pip install -r requirements.txt
   ```
5. Iniciar el servidor:
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
