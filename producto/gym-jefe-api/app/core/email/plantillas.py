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
        f"— {gimnasio} · GymDesk"
    )

    html = f"""<!doctype html>
<html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#111;">
  <p>Hola, {escape(nombre)}.</p>
  <p>Recibimos una solicitud para cambiar la contraseña de tu cuenta en <strong>{escape(gimnasio)}</strong>.</p>
  <p><a href="{escape(enlace)}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;">Crear nueva contraseña</a></p>
  <p style="font-size:13px;color:#555;">Si el botón no funciona, copia este enlace:<br>{escape(enlace)}</p>
  <p>El enlace sirve una sola vez y vence en {escape(vigencia)}. Si pides otro, este deja de servir.<br>
     Si no fuiste tú, ignora este correo: tu contraseña no cambia.</p>
  <p style="color:#555;">— {escape(gimnasio)} · GymDesk</p>
</body></html>"""

    return Correo(destinatario=destinatario, asunto=asunto, texto=texto, html=html)


def correo_pin_portal_deportista(
    destinatario: str,
    nombre: str,
    gimnasio: str,
    pin: str,
    vigencia_minutos: int = 15,
) -> Correo:
    """Plantilla de correo con el código PIN de 6 dígitos para el Portal del Deportista (activación o restablecimiento)."""
    asunto = f"Tu código de acceso: {pin} · {gimnasio}"

    texto = (
        f"Hola, {nombre}.\n\n"
        f"Tu código PIN de verificación para acceder a tu portal de deportista en {gimnasio} es:\n\n"
        f"    {pin}\n\n"
        f"Este código es de un solo uso y vence en {vigencia_minutos} minutos.\n"
        f"Por tu seguridad, nunca compartas este código con nadie.\n"
        f"Si no solicitaste este acceso, puedes ignorar este mensaje con tranquilidad.\n\n"
        f"— {gimnasio} · GymOS"
    )

    html = f"""<!doctype html>
<html lang="es"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#111827;background:#f9fafb;padding:24px;margin:0;">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:28px;">
    <h2 style="margin:0 0 12px 0;font-size:20px;color:#111827;">Hola, {escape(nombre)}</h2>
    <p style="margin:0 0 16px 0;color:#374151;">
      Usa el siguiente código PIN de verificación para activar o configurar tu contraseña en el portal de deportistas de <strong>{escape(gimnasio)}</strong>:
    </p>
    <div style="text-align:center;margin:24px 0;padding:18px;background:#eef2ff;border:1px dashed #6366f1;border-radius:10px;">
      <span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#312e81;font-family:monospace;">{escape(pin)}</span>
    </div>
    <p style="margin:0 0 12px 0;font-size:13px;color:#4b5563;">
      • Este código es de un solo uso y vence en <strong>{vigencia_minutos} minutos</strong>.<br>
      • Por tu seguridad, nunca compartas este PIN con terceros.<br>
      • Si no solicitaste este código, ignora este correo.
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;">
    <p style="margin:0;font-size:12px;color:#6b7280;">— {escape(gimnasio)} · GymOS</p>
  </div>
</body></html>"""

    return Correo(destinatario=destinatario, asunto=asunto, texto=texto, html=html)
