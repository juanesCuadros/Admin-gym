# Guía de Despliegue en VPS — GymOS Super-Admin

Esta guía detalla el procedimiento paso a paso para desplegar la solución completa de **GymOS Super Administrador** (Base de datos PostgreSQL, Backend FastAPI y Frontend React Nginx) en cualquier servidor VPS (DigitalOcean, Hetzner, AWS EC2, Linode, Google Cloud, Oracle Cloud, etc.) utilizando Docker y Docker Compose.

---

## 1. Arquitectura de Contenedores en Producción

```text
[ Internet / Navegador / Dueños de Gym ]
                  │
                  ▼ (Puerto 80 / 443 HTTPS)
     ┌────────────────────────┐
     │   super-admin-vista    │  <-- Nginx 1.27 Alpine
     │   (React 19 + SPA)     │      (Gzip, Cache, Security Headers)
     └───────────┬────────────┘
                 │ Proxy interno: /api/ -> :8000
                 ▼
     ┌────────────────────────┐
     │    super-admin-api     │  <-- FastAPI (Python 3.11)
     │   (Lógica y Dominio)   │      (Uvicorn, Alembic, Argon2id)
     └───────────┬────────────┘
                 │ Conexión interna: :5432
                 ▼
     ┌────────────────────────┐
     │        postgres        │  <-- PostgreSQL 16 Alpine
     │ (superadmin + platform)│      (Volumen persistente: pgdata_prod)
     └────────────────────────┘
```

> **Aislamiento de red:** PostgreSQL y FastAPI están en una red interna de Docker (`gymos_internal_net`). El puerto 5432 **NO** está expuesto a internet, protegiendo la base de datos de accesos externos no autorizados.

---

## 2. Requisitos Mínimos del Servidor VPS

- **Sistema Operativo:** Ubuntu 22.04 LTS, Ubuntu 24.04 LTS o Debian 12.
- **Hardware Mínimo:** 1 vCPU, 1 GB RAM (recomendado 2 GB o activar 2 GB de SWAP), 20 GB de disco SSD.
- **Red:** Dirección IP pública estática y puertos 80 y 443 abiertos.

---

## 3. Preparación Inicial del Servidor (Solo una vez)

Conéctate por SSH a tu VPS:
```bash
ssh root@IP_DE_TU_VPS
```

### 3.1 Actualizar paquetes del sistema
```bash
sudo apt update && sudo apt upgrade -y
```

### 3.2 Configurar Firewall (UFW)
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

### 3.3 Instalar Docker y Docker Compose
Ejecuta el script oficial de Docker:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo systemctl enable docker
sudo systemctl start docker
```

Verifica la instalación:
```bash
docker --version
docker compose version
```

---

## 4. Despliegue de la Aplicación

### 4.1 Clonar o copiar el repositorio
```bash
cd /opt
sudo git clone https://github.com/juandavidm23/GymBros-SMP.git gymos-superadmin
cd gymos-superadmin/Super-admin
```

### 4.2 Configurar Variables de Entorno de Producción
Copia la plantilla de producción:
```bash
cp .env.production.example .env.production
```

Edita `.env.production` con tus valores reales:
```bash
nano .env.production
```

#### Parámetros Críticos a Configurar:
1. `POSTGRES_PASSWORD`: Contraseña robusta para la base de datos (puedes generarla con `openssl rand -base64 24`).
2. `JWT_SECRET_KEY`: Llave criptográfica para los tokens de sesión (genera una con `openssl rand -hex 32`).
3. `FIRST_SUPERADMIN_EMAIL`: Tu correo de Super Administrador (ej. `admin@tudominio.com`).
4. `FIRST_SUPERADMIN_PASSWORD`: Tu contraseña de acceso a la plataforma.
5. `BASE_DOMAIN`: El dominio base de tu plataforma SaaS (ej. `gymos.io` o `tudominio.com`).
6. `CORS_ORIGINS`: Dominios autorizados (ej. `'["https://superadmin.tudominio.com", "https://tudominio.com"]'`).

### 4.3 Ejecutar el Despliegue

#### Opción A: Mediante el script automatizado (Recomendado)
```bash
chmod +x deploy-vps.sh
./deploy-vps.sh
```

#### Opción B: Mediante comando directo de Docker
```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

---

## 5. Configurar Dominio y Certificado SSL (HTTPS) con Let's Encrypt

Para habilitar HTTPS gratuito y seguro en tu dominio (ej. `superadmin.tudominio.com`):

### 5.1 Apuntar el registro DNS
En tu panel de DNS (Cloudflare, Namecheap, GoDaddy, etc.):
- Crea un registro de tipo **A**:
  - **Nombre:** `superadmin` (o `@` si es dominio raíz)
  - **Valor (IP):** `IP_DE_TU_VPS`
  - **TTL:** Automático

### 5.2 Configuración de Nginx en el Host para SSL (Terminación SSL)
Si prefieres que Nginx del host gestione los certificados SSL:

1. Modifica en `.env.production` el puerto del frontend para no competir con el puerto 80 del host:
   ```env
   HOST_HTTP_PORT=8080
   ```
   Reinicia los contenedores:
   ```bash
   docker compose -f docker-compose.prod.yml --env-file .env.production up -d
   ```

2. Instala Nginx y Certbot en el servidor host:
   ```bash
   sudo apt install -y nginx certbot python3-certbot-nginx
   ```

3. Crea la configuración de Nginx (`/etc/nginx/sites-available/gymos.conf`):
   ```nginx
   server {
       server_name superadmin.tudominio.com;

       location / {
           proxy_pass http://127.0.0.1:8080;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

4. Habilita el sitio y emite el certificado SSL:
   ```bash
   sudo ln -s /etc/nginx/sites-available/gymos.conf /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   sudo certbot --nginx -d superadmin.tudominio.com
   ```

Certbot renovará el certificado automáticamente antes de su vencimiento.

---

## 6. Mantenimiento y Operación Continua

### Ver el estado de los contenedores
```bash
docker compose -f docker-compose.prod.yml ps
```

### Inspeccionar logs en tiempo real
```bash
# Ver todos los logs
docker compose -f docker-compose.prod.yml logs -f

# Ver únicamente logs del backend API
docker compose -f docker-compose.prod.yml logs -f super-admin-api

# Ver únicamente logs del frontend Nginx
docker compose -f docker-compose.prod.yml logs -f super-admin-vista
```

### Actualizar a una nueva versión de código
Para desplegar actualizaciones sin perder datos de la base de datos:
```bash
git pull origin main
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

### Respaldos de la Base de Datos (Backups)

#### Crear un respaldo manual:
```bash
docker exec -t gymos_postgres_prod pg_dump -U gymos_prod_admin gymos_production_db > backup_$(date +%Y%m%d_%H%M%S).sql
```

#### Restaurar un respaldo:
```bash
cat backup_20260909_120000.sql | docker exec -i gymos_postgres_prod psql -U gymos_prod_admin -d gymos_production_db
```

#### Configurar respaldo automático diario (Cron Job):
Ejecuta `crontab -e` y agrega al final:
```cron
0 3 * * * docker exec -t gymos_postgres_prod pg_dump -U gymos_prod_admin gymos_production_db | gzip > /opt/backups/gymos_$(date +\%Y\%m\%d).sql.gz
```

---

## 7. Verificación de Seguridad y Salud

Puedes verificar en cualquier momento el estado de la API ejecutando:
```bash
curl -i http://localhost/api/v1/health
# o desde tu navegador:
https://superadmin.tudominio.com/api/v1/health
```

Respuesta esperada:
```json
{
  "status": "online",
  "database": "healthy",
  "version": "1.0.0",
  "app": "GymOS Super-Admin Backend"
}
```
