"""Tarea 7 · Adaptador de correo (modos log/resend) y normalización del teléfono."""
import pytest

from app.application.use_cases.signup_use_cases import normalizar_telefono
from app.core import correo as modulo_correo
from app.core.correo import AdaptadorCorreoLog, AdaptadorCorreoResend, obtener_correo


def test_modo_log_guarda_en_bandeja():
    AdaptadorCorreoLog.bandeja.clear()
    assert obtener_correo("log").enviar("a@b.co", "Asunto", "Cuerpo") is True
    assert AdaptadorCorreoLog.bandeja[-1].destinatario == "a@b.co"


def test_modo_resend_exige_api_key(monkeypatch):
    monkeypatch.setattr(modulo_correo.settings, "RESEND_API_KEY", None)
    with pytest.raises(RuntimeError):
        obtener_correo("resend")
    monkeypatch.setattr(modulo_correo.settings, "RESEND_API_KEY", "re_x")
    assert isinstance(obtener_correo("resend"), AdaptadorCorreoResend)


def test_modo_desconocido_falla():
    with pytest.raises(RuntimeError):
        obtener_correo("smtp")


@pytest.mark.parametrize("entrada,esperado", [
    ("+57 300 123 4567", "3001234567"),
    ("300-123-4567", "3001234567"),
    ("573001234567", "3001234567"),
    ("6015551234", "6015551234"),
])
def test_normalizar_telefono(entrada, esperado):
    assert normalizar_telefono(entrada) == esperado
