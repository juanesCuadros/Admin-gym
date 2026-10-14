"""Tarea 1 · Fechas de negocio en Bogotá (SA-RNF-08) y documentación solo fuera de producción."""
import os
import pathlib
import re
import subprocess
import sys
from datetime import datetime, timezone

from app.core.fechas import fecha_bogota, hoy_bogota

RAIZ = pathlib.Path(__file__).resolve().parents[2]


def test_cambio_de_dia_utc_sigue_siendo_el_dia_de_bogota():
    # 00:30 UTC del 14-oct = 19:30 del 13-oct en Bogotá.
    assert fecha_bogota(datetime(2026, 10, 14, 0, 30, tzinfo=timezone.utc)).isoformat() == "2026-10-13"
    # 05:00 UTC = medianoche en Bogotá: ya es el día siguiente.
    assert fecha_bogota(datetime(2026, 10, 14, 5, 0, tzinfo=timezone.utc)).isoformat() == "2026-10-14"


def test_hoy_bogota_coincide_con_la_fecha_de_bogota_del_instante_actual():
    assert hoy_bogota() == fecha_bogota(datetime.now(timezone.utc))


def test_la_app_no_usa_date_today_ni_datetime_now_sin_zona():
    prohibidos = re.compile(r"date\.today\(|datetime\.now\(\)|datetime\.utcnow\(")
    hallazgos = []
    for archivo in (RAIZ / "app").rglob("*.py"):
        for n, linea in enumerate(archivo.read_text(encoding="utf-8").splitlines(), 1):
            if prohibidos.search(linea) or re.search(r"default(_factory)?=date\.today", linea):
                hallazgos.append(f"{archivo.relative_to(RAIZ)}:{n}")
    assert hallazgos == []


def _rutas_docs(environment: str) -> str:
    codigo = (
        "from fastapi.testclient import TestClient\n"
        "from app.main import app\n"
        "c = TestClient(app)\n"
        "print(c.get('/docs').status_code, c.get('/redoc').status_code, c.get('/openapi.json').status_code)\n"
    )
    env = dict(os.environ, ENVIRONMENT=environment, DATABASE_URL="sqlite:///:memory:")
    salida = subprocess.run(
        [sys.executable, "-c", codigo], cwd=RAIZ, env=env, capture_output=True, text=True, timeout=120
    )
    assert salida.returncode == 0, salida.stderr
    return salida.stdout.strip().splitlines()[-1]


def test_docs_ocultos_en_produccion():
    assert _rutas_docs("production") == "404 404 404"


def test_docs_visibles_en_desarrollo():
    assert _rutas_docs("development") == "200 200 200"
