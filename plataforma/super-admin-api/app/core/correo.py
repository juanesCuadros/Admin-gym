"""Adaptador de correo saliente del Super-Admin.

Modos (variable CORREO_MODO):
  - "log":    desarrollo y pruebas. No envía nada: registra el mensaje en el log y lo guarda en
              una bandeja en memoria (`AdaptadorCorreoLog.bandeja`) para poder inspeccionarlo.
  - "resend": envía con la API HTTP de Resend (RESEND_API_KEY, CORREO_REMITENTE).
Un fallo de envío nunca se propaga al usuario: se registra en el log y `enviar` devuelve False.
"""
import logging
from collections import deque
from dataclasses import dataclass
from typing import Deque, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger("gymos.correo")


@dataclass(frozen=True)
class MensajeCorreo:
    destinatario: str
    asunto: str
    texto: str


class AdaptadorCorreo:
    def enviar(self, destinatario: str, asunto: str, texto: str) -> bool:  # pragma: no cover - interfaz
        raise NotImplementedError


class AdaptadorCorreoLog(AdaptadorCorreo):
    bandeja: Deque[MensajeCorreo] = deque(maxlen=100)

    def enviar(self, destinatario: str, asunto: str, texto: str) -> bool:
        self.bandeja.append(MensajeCorreo(destinatario, asunto, texto))
        logger.info("[correo:log] para=%s asunto=%s\n%s", destinatario, asunto, texto)
        return True


class AdaptadorCorreoResend(AdaptadorCorreo):
    URL = "https://api.resend.com/emails"

    def __init__(self, api_key: str, remitente: str):
        self.api_key = api_key
        self.remitente = remitente

    def enviar(self, destinatario: str, asunto: str, texto: str) -> bool:
        try:
            r = httpx.post(
                self.URL,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={"from": self.remitente, "to": [destinatario], "subject": asunto, "text": texto},
                timeout=10,
            )
            if r.status_code >= 400:
                logger.error("[correo:resend] fallo %s al enviar a %s", r.status_code, destinatario)
                return False
            return True
        except httpx.HTTPError as exc:
            logger.error("[correo:resend] error de red al enviar a %s: %s", destinatario, exc)
            return False


def obtener_correo(modo: Optional[str] = None) -> AdaptadorCorreo:
    modo = (modo or settings.CORREO_MODO).strip().lower()
    if modo == "resend":
        if not settings.RESEND_API_KEY:
            raise RuntimeError("CORREO_MODO=resend exige RESEND_API_KEY")
        return AdaptadorCorreoResend(settings.RESEND_API_KEY, settings.CORREO_REMITENTE)
    if modo == "log":
        return AdaptadorCorreoLog()
    raise RuntimeError(f"CORREO_MODO desconocido: {modo}")
