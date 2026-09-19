"""
Adaptador de correo saliente con dos modos, elegidos por `EMAIL_MODO`:

- `log`    (por defecto): escribe el correo completo en el log del servidor. Modo de desarrollo
           mientras no haya dominio verificado en Resend.
- `resend`: `POST https://api.resend.com/emails` con `Authorization: Bearer $RESEND_API_KEY`.

Regla: un fallo de envío NUNCA falla la petición del usuario. Se registra y se sigue.
El usuario no debe poder saber si el correo salió o no (GW-RF-00.2 CA1).
"""
import logging
from dataclasses import dataclass
from typing import Optional

import httpx

from app.core.config import settings

logger = logging.getLogger("gymos.email")

RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SEGUNDOS = 10.0


@dataclass(frozen=True)
class Correo:
    destinatario: str
    asunto: str
    texto: str
    html: str


class EmailAdaptador:
    """Punto único de salida de correo. Instanciar con `email_adaptador` (abajo)."""

    def __init__(self, modo: Optional[str] = None, api_key: Optional[str] = None, remitente: Optional[str] = None):
        self.modo = (modo or settings.EMAIL_MODO).lower()
        self.api_key = api_key if api_key is not None else settings.RESEND_API_KEY
        self.remitente = remitente or settings.EMAIL_REMITENTE

    async def enviar(self, correo: Correo) -> bool:
        """Envía el correo. Devuelve True si salió; False si falló. Nunca lanza."""
        try:
            if self.modo == "resend":
                return await self._enviar_resend(correo)
            return self._enviar_log(correo)
        except Exception:  # noqa: BLE001 — la regla es no propagar nada al usuario
            logger.exception("Fallo inesperado enviando correo a %s (modo=%s)", correo.destinatario, self.modo)
            return False

    # ------------------------------------------------------------------
    def _enviar_log(self, correo: Correo) -> bool:
        logger.info(
            "\n========== CORREO (modo log) ==========\n"
            "De:      %s\nPara:    %s\nAsunto:  %s\n"
            "---------- texto ----------\n%s\n"
            "=======================================",
            self.remitente,
            correo.destinatario,
            correo.asunto,
            correo.texto,
        )
        return True

    async def _enviar_resend(self, correo: Correo) -> bool:
        if not self.api_key or not self.api_key.startswith("re_"):
            logger.error("EMAIL_MODO=resend pero RESEND_API_KEY no está configurada (debe empezar por 're_').")
            return False

        payload = {
            "from": self.remitente,
            "to": [correo.destinatario],
            "subject": correo.asunto,
            "text": correo.texto,
            "html": correo.html,
        }
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}

        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SEGUNDOS) as client:
                resp = await client.post(RESEND_URL, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("Resend no respondió para %s: %s", correo.destinatario, exc)
            return False

        if resp.status_code >= 400:
            # El cuerpo de error de Resend no trae el contenido del correo; se puede registrar.
            logger.error("Resend rechazó el correo a %s: HTTP %s %s", correo.destinatario, resp.status_code, resp.text[:300])
            return False

        logger.info("Correo enviado por Resend a %s (id=%s)", correo.destinatario, resp.json().get("id") if resp.content else "?")
        return True


email_adaptador = EmailAdaptador()
