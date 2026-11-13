"""
Criterio de terminado de la fase 1 de GymDesk Escritorio: 24 h sin red, se reconecta y no hay
duplicados ni pérdidas. Prueba ACELERADA (reloj simulado), contra la API y el PostgreSQL reales.

Qué hace:
  1. Crea un gimnasio de prueba con Jefe y recepcionista en la base indicada.
  2. Levanta la API del gimnasio (uvicorn) contra esa base.
  3. Pide un código de estación como lo haría el Jefe.
  4. Corre la prueba de la estación (Rust): activa, trabaja 24 h simuladas sin red, pierde una
     respuesta, se cierra a mitad de envío, reabre y sincroniza.
  5. Compara lo que dice la estación con lo que quedó en el servidor.
  6. Borra el gimnasio de prueba.

Uso (desde producto/gym-jefe-api, con su entorno virtual):
  $env:DATABASE_URL = "postgresql+asyncpg://gymos_platform:...@localhost:<puerto>/<tu_base>"
  $env:TEST_ADMIN_DATABASE_URL = "postgresql+asyncpg://postgres:...@localhost:<puerto>/<tu_base>"
  .\\.venv\\Scripts\\python.exe ..\\gym-desk-escritorio\\pruebas\\prueba_24h.py

Nunca contra gymos_db ni contra producción: crea y borra datos.
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ESCRITORIO = AQUI.parent
API_DIR = ESCRITORIO.parent / "gym-jefe-api"
PUERTO = int(os.environ.get("GYMDESK_PRUEBA_PUERTO", "8011"))
API = f"http://127.0.0.1:{PUERTO}/api/v1"

sys.path.insert(0, str(API_DIR))
os.chdir(API_DIR)

if "gymos_db" in os.environ.get("DATABASE_URL", "gymos_db"):
    sys.exit("Define DATABASE_URL con la base de tu carril. Esta prueba no corre contra gymos_db.")

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text  # noqa: E402

from tests.conftest import Fabrica  # noqa: E402
from tests.sync_util import sql  # noqa: E402


def http(metodo: str, ruta: str, cuerpo: dict | None = None, token: str | None = None) -> dict:
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(API + ruta, data=datos, method=metodo, headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def esperar_api(proceso: subprocess.Popen) -> None:
    for _ in range(120):
        if proceso.poll() is not None:
            sys.exit("La API no arrancó. Revisa DATABASE_URL.")
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{PUERTO}/health", timeout=2)
            return
        except Exception:
            time.sleep(0.5)
    sys.exit("La API no respondió a tiempo.")


async def main() -> int:
    fabrica = Fabrica()
    api = None
    try:
        gym = await fabrica.crear_gimnasio()
        jefe = await fabrica.crear_staff(gym, rol="jefe")
        recepcion = await fabrica.crear_staff(gym, rol="recepcionista")
        print(f"Gimnasio de prueba: {gym.subdominio}")

        api = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PUERTO), "--log-level", "warning"],
            cwd=API_DIR,
        )
        esperar_api(api)

        sesion = http("POST", "/auth/login", {"subdominio": gym.subdominio, "correo": jefe["correo"], "password": jefe["password"]})
        estacion = http("POST", "/estaciones", {"nombre": "Recepción (prueba 24 h)"}, sesion["access_token"])

        salida = Path(tempfile.gettempdir()) / f"gymdesk_24h_{gym.subdominio}.json"
        entorno = {
            **os.environ,
            "GYMDESK_API_URL": API,
            "GYMDESK_PRUEBA_SUBDOMINIO": gym.subdominio,
            "GYMDESK_PRUEBA_CODIGO": estacion["codigo"],
            "GYMDESK_PRUEBA_CORREO": recepcion["correo"],
            "GYMDESK_PRUEBA_PASSWORD": recepcion["password"],
            "GYMDESK_PRUEBA_SALIDA": str(salida),
        }
        inicio = time.time()
        rust = subprocess.run(
            ["cargo", "test", "--color", "never", "-j", "3", "veinticuatro_horas", "--", "--ignored", "--nocapture"],
            cwd=ESCRITORIO / "src-tauri", env=entorno, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        lineas = [l for l in (rust.stdout + rust.stderr).splitlines() if "LNK4099" not in l and "ossl_static" not in l]
        print("\n".join(l for l in lineas if l.startswith("test ") or "panicked" in l or "assert" in l or "left:" in l or "right:" in l))
        if rust.returncode != 0 or not salida.exists():
            print("\n".join(lineas[-25:]))
            print("\nRESULTADO: FALLÓ la prueba de la estación")
            return 1
        informe = json.loads(salida.read_text(encoding="utf-8"))
        salida.unlink()

        # --- Lo que quedó en el servidor ---
        recibidas = await sql(gym.id, "SELECT o.operacion_id::text AS id, o.resultado FROM platform.sync_operaciones o ORDER BY o.id")
        eventos = await sql(
            gym.id,
            "SELECT detalle->>'operacion_id' AS id, detalle->>'ocurrida_en' AS ocurrida FROM platform.auditoria_gym a WHERE a.accion LIKE 'ESTACION\\_%' ORDER BY a.id",
        )
        revisiones = await sql(gym.id, "SELECT count(*) AS n FROM platform.sync_revisiones")
        cadena = await sql(
            gym.id,
            """SELECT count(*) AS rotas FROM (
                 SELECT hash_previo, lag(hash_actual) OVER (ORDER BY id) AS anterior FROM platform.auditoria_gym
               ) x WHERE anterior IS NOT NULL AND hash_previo <> anterior""",
        )

        ids_estacion = informe["ids"]
        ids_servidor = [f["id"] for f in recibidas]
        ids_auditoria = [f["id"] for f in eventos]
        ocurridas = [f["ocurrida"] for f in eventos]
        horas = (max(ocurridas) > min(ocurridas)) and ocurridas

        comprobaciones = [
            ("La estación registró operaciones", informe["operaciones"] > 300, informe["operaciones"]),
            ("El servidor recibió la misma cantidad", len(ids_servidor) == informe["operaciones"], len(ids_servidor)),
            ("Sin duplicados en el servidor", len(set(ids_servidor)) == len(ids_servidor), len(ids_servidor) - len(set(ids_servidor))),
            ("Sin pérdidas: los mismos identificadores", set(ids_servidor) == set(ids_estacion), len(set(ids_estacion) - set(ids_servidor))),
            ("Mismo orden en que ocurrieron", ids_servidor == ids_estacion, "-"),
            ("Un evento de auditoría por operación, en el mismo orden", ids_auditoria == ids_estacion, len(ids_auditoria)),
            ("Todas aplicadas, ninguna por revisar", all(f["resultado"] == "aplicada" for f in recibidas) and revisiones[0]["n"] == 0, revisiones[0]["n"]),
            ("Cadena de auditoría del servidor íntegra", cadena[0]["rotas"] == 0, cadena[0]["rotas"]),
            ("Se transmitieron de más y el servidor las descartó", informe["operaciones_transmitidas"] > informe["operaciones"], informe["operaciones_transmitidas"] - informe["operaciones"]),
        ]
        print(f"\nPrueba acelerada: {informe['horas_simuladas']} h simuladas en {time.time() - inicio:.0f} s reales")
        print(f"En cola al reconectar: {informe['en_cola_al_reconectar']} · envíos HTTP: {informe['envios_http']}")
        if horas:
            print(f"Primer evento: {min(ocurridas)} · último: {max(ocurridas)}")
        ok = True
        for nombre, paso, dato in comprobaciones:
            ok = ok and bool(paso)
            print(f"  [{'OK' if paso else 'FALLA'}] {nombre} ({dato})")
        print(f"\nRESULTADO: {'PASÓ' if ok else 'FALLÓ'}")
        return 0 if ok else 1
    finally:
        if api is not None:
            api.terminate()
            try:
                api.wait(timeout=10)
            except subprocess.TimeoutExpired:
                api.kill()
        # sync_operaciones y sync_revisiones referencian a la estación con RESTRICT: se borran antes.
        async with fabrica.admin_engine.begin() as conn:
            for g in fabrica.gimnasios:
                await conn.execute(text("DELETE FROM platform.sync_revisiones WHERE gimnasio_id = :g"), {"g": g.id})
                await conn.execute(text("DELETE FROM platform.sync_operaciones WHERE gimnasio_id = :g"), {"g": g.id})
        await fabrica.limpiar()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
