# Correo saliente (`app/core/email`)

Un solo punto de salida: `email_adaptador.enviar(Correo)`. Dos modos, elegidos por variable de entorno.

| Variable | Valor |
|---|---|
| `EMAIL_MODO` | `log` (por defecto) o `resend` |
| `RESEND_API_KEY` | La clave de Resend; empieza por `re_` |
| `EMAIL_REMITENTE` | Por ejemplo `GymOS <no-reply@tudominio.com>` |
| `APP_URL_BASE` | Base del enlace al Sistema Web. Admite `{subdominio}`: `https://{subdominio}.gymos.co`. Sin marcador (`http://localhost:3000`) se agrega `?subdominio=` |

Reglas:

- **Un fallo de envío nunca falla la petición del usuario.** Se registra en el log y la respuesta es la misma.
- En modo `log` el correo completo (con el enlace) queda en el log del servidor: `docker logs gymos-dev-api-1`.
- Plantillas en `plantillas.py`: texto plano + HTML simple, en español, sin imágenes externas. Hoy solo hay una: recuperación de contraseña.

## Pasar a `resend` cuando haya dominio

1. Crear la clave en <https://resend.com/api-keys> (permiso *Sending access*). Guardarla como `RESEND_API_KEY` en el `.env` del VPS, nunca en el repo.
2. Verificar el dominio en <https://resend.com/domains>: agregar los registros DNS (SPF, DKIM y opcionalmente DMARC) que Resend indique y esperar a que marque *Verified*.
3. Poner `EMAIL_REMITENTE="GymOS <no-reply@tudominio.com>"` con una dirección de ese dominio.
4. Cambiar `EMAIL_MODO=resend` y reiniciar `gym-jefe-api`.

> Sin dominio verificado, el remitente de prueba `onboarding@resend.dev` **solo entrega a la dirección de la cuenta de Resend**. Por eso el modo por defecto es `log`.

Para probar el envío real sin tocar el flujo de recuperación:

```bash
python -c "
import asyncio; from app.core.email import email_adaptador, Correo
print(asyncio.run(email_adaptador.enviar(Correo('tu@correo.com', 'Prueba GymOS', 'Hola', '<p>Hola</p>'))))"
```
