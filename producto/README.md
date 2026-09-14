# GymOS — Producto (Gym Tenant SaaS)

Aplicación operativa utilizada diariamente por cada gimnasio (Dueños/Jefes, Recepcionistas, Entrenadores y Socios).

## Componentes

- **`gym-jefe-api/`**: Backend asíncrono desarrollado en FastAPI, SQLAlchemy 2.0 (asyncpg), WebSockets nativos para pantallas TV y torniquetes, con aislamiento multi-tenant estricto gobernado por PostgreSQL Row-Level Security (RLS).
- **`gym-jefe-web/`**: Frontend Single Page Application desarrollado en React 19, Vite, TypeScript y Vanilla CSS con inyección dinámica de temas y branding por tenant.
