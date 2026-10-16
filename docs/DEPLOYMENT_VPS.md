# Despliegue de GymOS en el VPS

Runbook del servidor de producción. Todo lo que se configura en el VPS sale de este repositorio (`infra/`);
nada se cambia a mano por SSH sin dejarlo versionado.

## 1. Cómo está armado

| Dato | Valor |
|---|---|
| VPS | Hostinger, Ubuntu 26.04, IP `179.236.234.196`, 7.7 GB RAM |
| Usuario de operación | `deploy` (grupo `docker`). Los comandos de esta guía se corren como `deploy` salvo que diga root |
| Repo en el VPS | `/home/deploy/gymos` (clon de `juanesCuadros/Admin-gym`, rama `main`, deploy key de solo lectura) |
| Variables y secretos | `/home/deploy/gymos/infra/.env` (`chmod 600`, nunca en git) |
| Respaldos | `/home/deploy/gymos-respaldos` + copia en Google Drive (`drive:gymos-respaldos`) |
| Proyecto compose | `gymos-prod` (`infra/docker-compose.yml`) |

El VPS es **compartido con resttodash**. Su contenedor `resttodash-nginx` es el dueño de los puertos 80/443 y
termina el HTTPS de los dos proyectos:

```
internet ──443──> resttodash-nginx ──red docker "resttodash"──> gymos-sitio  (sitio-publico)  ──> super-admin-api ─┐
                  (incluye infra/nginx/gymos.conf)            ├─> gymos-admin  (super-admin-vista) ──> super-admin-api ─┼─> db
                                                              └─> gymos-web    (web)               ──> api ─────────────┘
                                                                  red interna "gymos-prod_gymos": db y APIs no salen de aquí
```

| URL | Servicio |
|---|---|
| `https://gymdeskcolombia.com` (`www` redirige aquí) | `sitio-publico` (landing, planes, registro autónomo) |
| `https://admin.gymdeskcolombia.com` | `super-admin-vista` |
| `https://{subdominio}.gymdeskcolombia.com` | `web` (Sistema Web de cada gimnasio; hoy: `demo`) |

- Ningún contenedor de GymOS publica puertos. La BD (5432) no es accesible desde internet.
- `gymos.conf` usa `proxy_pass` con variable: si GymOS está caído, el nginx de resttodash sigue arrancando y solo
  los hosts de GymOS responden 502.
- Los certificados viven en la carpeta de certbot de resttodash
  (`/home/deploy/resttodash/infra/nginx/certbot/conf`), con el nombre `gymdeskcolombia.com` (SAN, no comodín).

### Reglas de convivencia con resttodash

- **No** se modifica, reinicia ni borra nada de resttodash sin acuerdo previo.
- Su nginx se cambia **solo por commit** en su repo (`infra/nginx/nginx.conf`, `infra/docker-compose.yml`): su
  workflow `infra.yml` hace `git reset --hard` en el VPS, valida con `nginx -t` y recrea el contenedor. Un cambio
  a mano en el servidor se pierde en el siguiente despliegue de resttodash.
- Antes de cualquier recarga del nginx de borde: `docker exec resttodash-nginx nginx -t`.

## 2. Primera instalación

### 2.1 Deploy key (una vez)

```bash
ssh-keygen -t ed25519 -f ~/.ssh/gymos_deploy -N "" -C "vps-gymos-solo-lectura"
printf '\nHost github-gymos\n    HostName github.com\n    User git\n    IdentityFile ~/.ssh/gymos_deploy\n    IdentitiesOnly yes\n' >> ~/.ssh/config
chmod 600 ~/.ssh/config
cat ~/.ssh/gymos_deploy.pub   # GitHub → Settings → Deploy keys → Add (SIN "Allow write access")
ssh -T github-gymos           # debe saludar con el nombre del repo
```

### 2.2 DNS (Hostinger)

Registros `A` a `179.236.234.196`: `@`, `www`, `admin`, `demo` (y uno por cada gimnasio nuevo). Sin `AAAA` en
esos nombres. Verificar desde el VPS:

```bash
for h in gymdeskcolombia.com www.gymdeskcolombia.com admin.gymdeskcolombia.com demo.gymdeskcolombia.com; do
  echo "$h → $(getent ahostsv4 $h | head -1 | cut -d' ' -f1)"; done
```

### 2.3 Clonar y crear el `.env`

```bash
git clone github-gymos:juanesCuadros/Admin-gym.git ~/gymos
cd ~/gymos/infra
cp .env.example .env && chmod 600 .env
for v in POSTGRES_PASSWORD GYMOS_SUPERADMIN_PASSWORD GYMOS_PLATFORM_PASSWORD SUPERADMIN_JWT_SECRET_KEY \
         PLATFORM_JWT_SECRET_KEY BIOMETRIC_ENCRYPTION_KEY; do
  sed -i "s/^$v=$/$v=$(openssl rand -hex 32)/" .env
done
nano .env   # poner FIRST_SUPERADMIN_PASSWORD (la que usará el Super Admin) y RESEND_API_KEY
grep -E '^[A-Z_]+=$' .env   # solo debe quedar MODULOS_ACTIVOS vacío
```

- `BIOMETRIC_ENCRYPTION_KEY` **no se puede cambiar después** sin perder las huellas registradas. Está incluida en
  el respaldo del `.env` (ver 4.4).
- `PLATFORM_CORS_ORIGINS` lista un origen por gimnasio publicado.

### 2.4 Levantar GymOS

```bash
cd ~/gymos/infra
docker compose up -d --build
docker compose ps          # los 6 servicios en "healthy" (la primera vez tarda unos minutos en compilar)
docker compose logs db | grep -E 'running|ignoring'      # corre 01_schema.sql y 02_arranque.sh; ignora migrations/
docker compose logs super-admin-api | grep "Super Admin inicial"
```

La BD nace de `infra/db/01_schema.sql` + `02_arranque.sh` (solo la primera vez, con el volumen vacío).
Postgres ignora `migrations/` y `crear-bd-carril.ps1`.

### 2.5 Certificado (antes de conectar el nginx)

El primer `server` de puerto 80 de resttodash ya responde `/.well-known/acme-challenge/` para cualquier host, así
que el certificado se emite **antes** de incluir `gymos.conf` (si se incluye sin certificado, `nginx -t` falla).

```bash
cd /home/deploy/resttodash/infra
docker run --rm -v "$PWD/nginx/certbot/conf:/etc/letsencrypt" -v "$PWD/nginx/certbot/www:/var/www/certbot" \
  certbot/certbot certonly --webroot -w /var/www/certbot --cert-name gymdeskcolombia.com \
  -d gymdeskcolombia.com -d www.gymdeskcolombia.com -d admin.gymdeskcolombia.com -d demo.gymdeskcolombia.com \
  --email mvc.tech.popayan@gmail.com --agree-tos --no-eff-email
```

### 2.6 Conectar GymOS al nginx de resttodash

Cambio en el repo de resttodash (PR a `main`; su workflow lo aplica y recrea `resttodash-nginx`, ~2 s de corte):

1. `infra/nginx/nginx.conf`, dentro de `http {}`, justo antes del primer `server {`:
   ```nginx
       # GymOS (gymdeskcolombia.com): bloques versionados en el repo de GymOS, montados en /etc/nginx/gymos.
       # Con comodín: si la carpeta está vacía, nginx arranca igual.
       include /etc/nginx/gymos/*.conf;
   ```
2. `infra/docker-compose.yml`, servicio `nginx`, en `volumes`:
   ```yaml
         # GymOS: carpeta (no archivo suelto), así un git pull de GymOS se ve con un reload.
         - /home/deploy/gymos/infra/nginx:/etc/nginx/gymos:ro
   ```
3. `.github/workflows/infra.yml`, en el `nginx -t` de validación, agregar el mismo montaje
   `-v /home/deploy/gymos/infra/nginx:/etc/nginx/gymos:ro` para que la validación incluya a GymOS.

**Revertir:** revertir ese PR (el workflow vuelve a recrear el nginx sin GymOS).

### 2.7 Verificación

```bash
docker ps --format '{{.Names}} {{.Status}}' | grep resttodash      # resttodash igual que antes
curl -sI https://resttodash.app | head -1                            # resttodash responde
curl -s https://gymdeskcolombia.com/api/v1/public/plans | head -c 100 # planes del sitio público
curl -s -o /dev/null -w '%{http_code}\n' https://admin.gymdeskcolombia.com/api/v1/docs   # 404
curl -s -o /dev/null -w '%{http_code}\n' https://demo.gymdeskcolombia.com/api/v1/docs    # 404
```

En el navegador: login del Super Admin → crear el gimnasio `demo` con su Jefe → el enlace de acceso abre
`https://demo.gymdeskcolombia.com` → flujo de recepción (cliente, membresía cobrada, ingreso, salida, "Ingresos de
hoy") → Pantalla TV conecta por `wss://` sin errores en consola. Contraseña mala: mensaje en español.

## 3. Operación

### 3.1 Actualizar a una nueva versión

```bash
cd ~/gymos && git pull
~/gymos/infra/backup/respaldo.sh                   # respaldo antes de tocar nada
cd infra && docker compose up -d --build && docker compose ps
# Si cambió infra/nginx/gymos.conf:
docker exec resttodash-nginx nginx -t && docker exec resttodash-nginx nginx -s reload
```

### 3.2 Cambios de esquema

No hay runner de migraciones. `01_schema.sql` es la fuente única del esquema (solo aplica en una BD nueva); en
producción, cada cambio se aplica con su archivo de `infra/db/migrations/`:

```bash
~/gymos/infra/backup/respaldo.sh
cd ~/gymos/infra
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < db/migrations/NNN_nombre.sql
docker compose restart api super-admin-api
```

### 3.3 Agregar un gimnasio con subdominio propio

1. DNS: registro `A` `<sub>` → `179.236.234.196`.
2. Ampliar el certificado (repetir **todos** los `-d` actuales más el nuevo; ver los actuales con
   `certbot certificates`):
   ```bash
   cd /home/deploy/resttodash/infra
   docker run --rm -v "$PWD/nginx/certbot/conf:/etc/letsencrypt" -v "$PWD/nginx/certbot/www:/var/www/certbot" \
     certbot/certbot certonly --webroot -w /var/www/certbot --cert-name gymdeskcolombia.com --expand \
     -d gymdeskcolombia.com -d www.gymdeskcolombia.com -d admin.gymdeskcolombia.com -d demo.gymdeskcolombia.com -d <sub>.gymdeskcolombia.com
   docker exec resttodash-nginx nginx -t && docker exec resttodash-nginx nginx -s reload
   ```
3. Agregar `https://<sub>.gymdeskcolombia.com` a `PLATFORM_CORS_ORIGINS` en `.env` y `docker compose up -d api`.
4. Crear el gimnasio en el Super Admin con ese subdominio. `gymos.conf` no se toca: atiende cualquier subdominio.

### 3.4 Logs

```bash
cd ~/gymos/infra
docker compose logs -f --tail 100 api              # o super-admin-api, web, db...
docker logs --tail 100 resttodash-nginx 2>&1 | grep gymdesk
```

Los logs rotan solos (10 MB × 3 por contenedor).

### 3.5 Rollback de código

```bash
cd ~/gymos && git log --oneline -10
git checkout <commit_bueno> && cd infra && docker compose up -d --build
# Volver a la rama cuando esté corregido: git checkout main && git pull
```

Si la versión mala alcanzó a migrar el esquema, el rollback de código no basta: restaurar el respaldo previo (4.3).

## 4. Respaldos

### 4.1 Qué se respalda

- BD completa (`pg_dump -Fc`) cada día a las 3:00 a. m. (Bogotá): 7 diarios + 4 semanales (domingos).
- Copia espejo en Google Drive (`drive:gymos-respaldos`) con rclone.
- `infra/.env` **no** va en el respaldo automático: guardar una copia en un gestor de contraseñas (sin ella, las
  huellas cifradas con `BIOMETRIC_ENCRYPTION_KEY` no se pueden leer).

### 4.2 Instalación (una vez)

```bash
# como root
apt install -y rclone
# como deploy: configurar el remoto "drive" (Google Drive). En un VPS sin navegador, rclone pide correr
# `rclone authorize "drive"` en un PC con navegador y pegar el token que devuelve.
rclone config
rclone mkdir drive:gymos-respaldos
mkdir -p ~/gymos-respaldos
timedatectl | grep "Time zone"   # la línea de cron de abajo asume que el VPS está en UTC
crontab -e
# agregar (08:00 UTC = 03:00 Bogotá):
0 8 * * * RCLONE_DESTINO=drive:gymos-respaldos /home/deploy/gymos/infra/backup/respaldo.sh >> /home/deploy/gymos-respaldos/respaldo.log 2>&1
```

Probar a mano la primera vez: `RCLONE_DESTINO=drive:gymos-respaldos ~/gymos/infra/backup/respaldo.sh` y luego
`~/gymos/infra/backup/probar-restauracion.sh` (restaura en `gymos_restore_prueba`, compara conteos y la borra).
Repetir la prueba de restauración una vez al mes.

### 4.3 Restaurar en producción

Destructivo: reemplaza la BD actual. Hacer primero un respaldo de lo que haya.

```bash
cd ~/gymos/infra
~/gymos/infra/backup/respaldo.sh
docker compose stop api super-admin-api
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --exit-on-error' < ~/gymos-respaldos/diarios/gymos_AAAA-MM-DD_HHMM.dump
docker compose start api super-admin-api
```

Los roles `gymos_superadmin` y `gymos_platform` viven en el clúster (no en el dump): en un servidor nuevo, primero
levantar el stack con el mismo `.env` (los crea `01_schema.sql`/`02_arranque.sh`) y después restaurar así.

## 5. Certificados: renovación

Let's Encrypt emite por 90 días. `certbot renew` renueva todos los certificados de la carpeta compartida
(`gymdeskcolombia.com` y `resttodash.app`) que venzan en menos de 30 días; después hay que recargar el nginx de
borde (los certificados están en un montaje de carpeta, así que `reload` los toma).

> Pendiente de acordar con el dueño de resttodash dónde se versiona la tarea de renovación (cron del VPS), porque
> renueva también el certificado de resttodash. Comando:
>
> ```bash
> cd /home/deploy/resttodash/infra && \
> docker run --rm -v "$PWD/nginx/certbot/conf:/etc/letsencrypt" -v "$PWD/nginx/certbot/www:/var/www/certbot" \
>   certbot/certbot renew --webroot -w /var/www/certbot --quiet && \
> docker exec resttodash-nginx nginx -t && docker exec resttodash-nginx nginx -s reload
> ```
>
> Prueba sin emitir nada: el mismo `docker run` con `renew --dry-run`.
