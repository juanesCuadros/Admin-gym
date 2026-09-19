"""
Plantillas de correo. Texto plano y HTML simple, en español, sin imágenes externas.
Por ahora una sola: recuperación de contraseña.
"""
from html import escape

from app.core.config import settings
from app.core.email.adaptador import Correo


def url_sistema_web(subdominio: str, ruta: str) -> str:
    """
    Construye la URL pública del Sistema Web del gimnasio a partir de `APP_URL_BASE`.
    - Con marcador:  https://{subdominio}.gymos.co  →  https://powergym.gymos.co/recuperar/abc
    - Sin marcador:  http://localhost:3000          →  http://localhost:3000/recuperar/abc?subdominio=powergym
      (el frontend detecta el tenant por `?subdominio=` cuando no hay subdominio en el host)
    """
    base = settings.APP_URL_BASE.rstrip("/")
    ruta = "/" + ruta.lstrip("/")
    if "{subdominio}" in base:
        return base.replace("{subdominio}", subdominio) + ruta
    separador = "&" if "?" in ruta else "?"
    return f"{base}{ruta}{separador}subdominio={subdominio}"


def correo_recuperacion_password(destinatario: str, nombre: str, gimnasio: str, enlace: str, vigencia_minutos: int) -> Correo:
    asunto = f"Recupera tu contraseña · {gimnasio}"
    horas = vigencia_minutos // 60
    vigencia = f"{horas} hora" + ("s" if horas != 1 else "") if horas >= 1 else f"{vigencia_minutos} minutos"

    texto = (
        f"Hola, {nombre}.\n\n"
        f"Recibimos una solicitud para cambiar la contraseña de tu cuenta en {gimnasio}.\n"
        f"Abre este enlace para crear una nueva contraseña:\n\n{enlace}\n\n"
        f"El enlace sirve una sola vez y vence en {vigencia}. Si pides otro, este deja de servir.\n"
        f"Si no fuiste tú, ignora este correo: tu contraseña no cambia.\n\n"
        f"— {gimnasio} · GymOS"
    )

    html = f"""<!doctype html>
<html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;">
  <p>Hola, {escape(nombre)}.</p>
  <p>Recibimos una solicitud para cambiar la contraseña de tu cuenta en <strong>{escape(gimnasio)}</strong>.</p>
  <p><a href="{escape(enlace)}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;">Crear nueva contraseña</a></p>
  <p style="font-size:13px;color:#555;">Si el botón no funciona, copia este enlace:<br>{escape(enlace)}</p>
  <p>El enlace sirve una sola vez y vence en {escape(vigencia)}. Si pides otro, este deja de servir.<br>
     Si no fuiste tú, ignora este correo: tu contraseña no cambia.</p>
  <p style="color:#555;">— {escape(gimnasio)} · GymOS</p>
</body></html>"""

    return Correo(destinatario=destinatario, asunto=asunto, texto=texto, html=html)
