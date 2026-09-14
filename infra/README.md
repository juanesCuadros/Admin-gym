# GymOS — Infraestructura

Esta carpeta es la **ÚNICA fuente de verdad del servidor y la base de datos**.
Ninguna configuración se edita a mano por SSH en el VPS; todo se define en este directorio y se aplica mediante Docker Compose.

## Estructura

- **`db/01_schema.sql`**: Definición canónica completa del esquema PostgreSQL 16 (esquema `superadmin` y esquema `platform` con Row-Level Security).
- **`db/02_arranque.sh`**: Script de inicialización de roles, contraseñas, tabla `superadmin.tokens_invalidos` y políticas RLS para aprovisionamiento.
- **`docker-compose.dev.yml`**: Orquestación para desarrollo local (puertos mapeados en host).
- **`docker-compose.yml`**: Orquestación para producción VPS (servicios con `expose`, variables vía `.env`).
- **`.env.example`**: Plantilla de variables de entorno requeridas.
- **`nginx/nginx.conf`**: Configuración de gateway/reverse proxy para producción.

## Comandos Útiles

### Iniciar entorno de desarrollo:
```bash
docker compose -f docker-compose.dev.yml up -d --build
```

### Reiniciar con base de datos limpia:
```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d --build
```

### Ver estado y salud de los contenedores:
```bash
docker compose -f docker-compose.dev.yml ps
```
