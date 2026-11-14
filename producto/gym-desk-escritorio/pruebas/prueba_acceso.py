"""
Criterio de terminado de la fase 2 de GymDesk Escritorio: la evaluación local del ingreso da el
mismo resultado que el servidor. Contra la API y el PostgreSQL reales.

Qué hace:
  1. Crea un gimnasio de prueba (gracia 2 días, "por vencer" a 6: distintos a los valores por
     defecto, para probar que la estación usa los parámetros descargados) con clientes en cada
     situación: al día, por vencer, en gracia, vencidos, congelados, cancelados, sin membresía,
     desactivados, eliminados, con pase de día, con varias membresías.
  2. Levanta la API (uvicorn) contra esa base.
  3. Le pregunta al servidor por cada cliente: `evaluar-acceso` (estado y días) y
     `checkin-manual` (si abre, resultado y mensaje; es el que tiene en cuenta el pase de día).
  4. Corre la prueba de la estación (Rust): activa, descarga, evalúa a cada cliente con sus datos
     locales, registra un ingreso por cada uno y los sube.
  5. Compara las dos respuestas campo por campo, y revisa que los ingresos de la estación quedaron
     en el servidor con el mismo resultado y sin nada por revisar.
  6. Borra el gimnasio de prueba.

Uso (desde producto/gym-jefe-api, con su entorno virtual):
  $env:DATABASE_URL = "postgresql+asyncpg://gymos_platform:...@localhost:<puerto>/<tu_base>"
  $env:TEST_ADMIN_DATABASE_URL = "postgresql+asyncpg://postgres:...@localhost:<puerto>/<tu_base>"
  .\\.venv\\Scripts\\python.exe ..\\gym-desk-escritorio\\pruebas\\prueba_acceso.py

Nunca contra gymos_db ni contra producción: crea y borra datos.
"""
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ESCRITORIO = AQUI.parent
API_DIR = ESCRITORIO.parent / "gym-jefe-api"
PUERTO = int(os.environ.get("GYMDESK_PRUEBA_PUERTO", "8012"))
API = f"http://127.0.0.1:{PUERTO}/api/v1"

sys.path.insert(0, str(API_DIR))
os.chdir(API_DIR)

if "gymos_db" in os.environ.get("DATABASE_URL", "gymos_db"):
    sys.exit("Define DATABASE_URL con la base de tu carril. Esta prueba no corre contra gymos_db.")

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import text  # noqa: E402

from tests import sync_util as u  # noqa: E402
from tests.conftest import Fabrica  # noqa: E402
from tests.sync_util import sql  # noqa: E402

GRACIA, UMBRAL = 2, 6


def http(metodo: str, ruta: str, cuerpo: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(API + ruta, data=datos, method=metodo, headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


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


async def crear_clientes(gym_id, staff_id) -> dict:
    """Un cliente por situación. Devuelve {deportista_id: descripción}."""
    plan = await u.plan(gym_id, "Mensual")
    otro_plan = await u.plan(gym_id, "Trimestral")
    casos: dict = {}

    async def nuevo(descripcion: str, activo: bool = True) -> str:
        dep = await u.deportista(gym_id, f"Caso {len(casos) + 1:02d}", activo=activo)
        casos[dep] = descripcion
        return dep

    # Cada borde de la gracia (2 días) y del umbral de por vencer (6 días).
    for dias in (-40, -4, -3, -2, -1, 0, 1, 5, 6, 7, 8, 30, 365):
        await u.membresia(gym_id, await nuevo(f"vence en {dias} días"), plan, dias)

    await nuevo("sin membresía")
    await u.membresia(gym_id, await nuevo("solo una membresía cancelada"), plan, 20, cancelada=True)
    await u.membresia(gym_id, await nuevo("desactivado con membresía vigente", activo=False), plan, 20)
    await nuevo("desactivado sin membresía", activo=False)

    # Congelamientos.
    await u.congelamiento(gym_id, await u.membresia(gym_id, await nuevo("congelada sin fecha de fin"), plan, 20), -3)
    await u.congelamiento(gym_id, await u.membresia(gym_id, await nuevo("congelada desde hoy"), plan, 20), 0)
    await u.congelamiento(gym_id, await u.membresia(gym_id, await nuevo("congelada hasta mañana"), plan, 20), -3, 1)
    await u.congelamiento(gym_id, await u.membresia(gym_id, await nuevo("congelamiento que terminó hoy"), plan, 20), -5, 0)
    await u.congelamiento(gym_id, await u.membresia(gym_id, await nuevo("congelamiento que terminó ayer"), plan, 20), -5, -1)
    await u.congelamiento(gym_id, await u.membresia(gym_id, await nuevo("congelamiento que empieza mañana"), plan, 20), 1)
    await u.congelamiento(gym_id, await u.membresia(gym_id, await nuevo("vencida y congelada"), plan, -10), -20)
    await u.congelamiento(gym_id, await u.membresia(gym_id, await nuevo("desactivado y congelado", activo=False), plan, 20), -3)

    # Varias membresías.
    dep = await nuevo("una vencida y una vigente")
    await u.membresia(gym_id, dep, plan, -30)
    await u.membresia(gym_id, dep, otro_plan, 25)
    dep = await nuevo("vigente, y otra cancelada que vencía después")
    await u.membresia(gym_id, dep, plan, 3)
    await u.membresia(gym_id, dep, otro_plan, 90, cancelada=True)
    dep = await nuevo("dos que vencen el mismo día: manda la más nueva")
    await u.membresia(gym_id, dep, plan, 15, dias_de_creada=40)
    await u.membresia(gym_id, dep, otro_plan, 15, dias_de_creada=2)
    dep = await nuevo("congelada la que no manda")
    await u.congelamiento(gym_id, await u.membresia(gym_id, dep, plan, -30), -40)
    await u.membresia(gym_id, dep, otro_plan, 25)
    dep = await nuevo("vencida hace poco y otra vencida hace mucho")
    await u.membresia(gym_id, dep, plan, -1)
    await u.membresia(gym_id, dep, otro_plan, -200)

    # Pase de día.
    await u.venta(gym_id, staff_id, await nuevo("sin membresía, pase de día de hoy"), "pase_dia")
    await u.venta(gym_id, staff_id, await nuevo("sin membresía, pase de día anulado"), "pase_dia", anulada=True)
    await u.venta(gym_id, staff_id, await nuevo("sin membresía, pase de día de ayer"), "pase_dia", hace_dias=1)
    await u.venta(gym_id, staff_id, await nuevo("sin membresía, compró un pase de clase"), "pase_clase")
    await u.venta(gym_id, staff_id, await nuevo("desactivado con pase de día de hoy", activo=False), "pase_dia")
    dep = await nuevo("vencido con pase de día de hoy")
    await u.membresia(gym_id, dep, plan, -30)
    await u.venta(gym_id, staff_id, dep, "pase_dia")
    dep = await nuevo("en gracia con pase de día de hoy")
    await u.membresia(gym_id, dep, plan, -1)
    await u.venta(gym_id, staff_id, dep, "pase_dia")
    dep = await nuevo("congelado con pase de día de hoy")
    await u.congelamiento(gym_id, await u.membresia(gym_id, dep, plan, 20), -3)
    await u.venta(gym_id, staff_id, dep, "pase_dia")
    dep = await nuevo("al día con pase de día de hoy")
    await u.membresia(gym_id, dep, plan, 20)
    await u.venta(gym_id, staff_id, dep, "pase_dia")

    # Eliminado: para el servidor no existe (404) y para la estación tampoco.
    dep = await nuevo("eliminado con membresía vigente")
    await u.membresia(gym_id, dep, plan, 20)
    await sql(gym_id, "UPDATE platform.deportistas SET deleted_at = now() WHERE id = :id", {"id": dep})
    return casos


async def main() -> int:
    fabrica = Fabrica()
    api = None
    try:
        gym = await fabrica.crear_gimnasio()
        jefe = await fabrica.crear_staff(gym, rol="jefe")
        await sql(gym.id, "UPDATE platform.tenant SET dias_gracia_mora = :g, dias_umbral_por_vencer = :u WHERE id = :id",
                  {"g": GRACIA, "u": UMBRAL, "id": gym.id})
        casos = await crear_clientes(gym.id, jefe["id"])
        print(f"Gimnasio de prueba: {gym.subdominio} · {len(casos)} clientes · gracia {GRACIA} días · por vencer a {UMBRAL} días")

        api = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PUERTO), "--log-level", "warning"],
            cwd=API_DIR,
        )
        esperar_api(api)

        _, sesion = http("POST", "/auth/login", {"subdominio": gym.subdominio, "correo": jefe["correo"], "password": jefe["password"]})
        token = sesion["access_token"]
        _, estacion = http("POST", "/estaciones", {"nombre": "Recepción (prueba de acceso)"}, token)

        # --- Lo que dice el servidor de cada cliente ---
        servidor: dict = {}
        for dep in casos:
            st_eval, evaluacion = http("GET", f"/control-ingreso/evaluar-acceso/{dep}", token=token)
            st_chk, checkin = http("POST", "/control-ingreso/checkin-manual", {"deportista_id": dep}, token)
            if st_eval == 404 and st_chk == 404:
                continue  # eliminado
            assert st_eval == 200 and st_chk == 200, (casos[dep], st_eval, evaluacion, st_chk, checkin)
            servidor[dep] = {
                "estado": evaluacion["estado_calculado"], "dias_restantes_o_vencido": evaluacion["dias_restantes_o_vencido"],
                "resultado": checkin["resultado"], "abre": checkin["comando_torniquete"], "mensaje": checkin["mensaje"],
            }

        # --- Lo que dice la estación ---
        salida = Path(tempfile.gettempdir()) / f"gymdesk_acceso_{gym.subdominio}.json"
        entorno = {
            **os.environ,
            "GYMDESK_API_URL": API,
            "GYMDESK_PRUEBA_SUBDOMINIO": gym.subdominio,
            "GYMDESK_PRUEBA_CODIGO": estacion["codigo"],
            "GYMDESK_PRUEBA_CORREO": jefe["correo"],
            "GYMDESK_PRUEBA_PASSWORD": jefe["password"],
            "GYMDESK_PRUEBA_SALIDA": str(salida),
        }
        rust = subprocess.run(
            ["cargo", "test", "--color", "never", "-j", "3", "la_estacion_decide_el_ingreso_igual_que_el_servidor", "--", "--ignored", "--nocapture"],
            cwd=ESCRITORIO / "src-tauri", env=entorno, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        lineas = [l for l in (rust.stdout + rust.stderr).splitlines() if "LNK4099" not in l and "ossl_static" not in l]
        print("\n".join(l for l in lineas if l.startswith("test ") or "panicked" in l))
        if rust.returncode != 0 or not salida.exists():
            print("\n".join(lineas[-25:]))
            print("\nRESULTADO: FALLÓ la prueba de la estación")
            return 1
        informe = json.loads(salida.read_text(encoding="utf-8"))
        salida.unlink()
        estacion_dice: dict = informe["evaluados"]

        # --- Comparación campo por campo ---
        campos = ["estado", "dias_restantes_o_vencido", "resultado", "abre", "mensaje"]
        diferencias = []
        for dep, descripcion in casos.items():
            s, e = servidor.get(dep), estacion_dice.get(dep)
            if s is None or e is None:
                if (s is None) != (e is None):
                    diferencias.append((descripcion, "existe", s is not None, e is not None))
                continue
            for campo in campos:
                if s[campo] != e[campo]:
                    diferencias.append((descripcion, campo, s[campo], e[campo]))

        # --- Los ingresos que registró la estación, ya en el servidor ---
        subidos = await sql(
            gym.id,
            "SELECT c.operacion_id::text AS op, c.deportista_id::text AS dep, c.resultado FROM platform.checkins c WHERE c.operacion_id IS NOT NULL",
        )
        por_operacion = {f["op"]: f for f in subidos}
        registrados: dict = informe["registrados"]
        mal_guardados = [
            (casos[r["deportista_id"]], r["resultado"], por_operacion.get(op, {}).get("resultado"))
            for op, r in registrados.items()
            if por_operacion.get(op, {}).get("resultado") != r["resultado"] or por_operacion.get(op, {}).get("dep") != r["deportista_id"]
        ]
        revisiones = await sql(gym.id, "SELECT motivo_codigo, motivo FROM platform.sync_revisiones")

        estados = sorted({v["estado"] for v in estacion_dice.values()})
        resultados = sorted({v["resultado"] for v in estacion_dice.values()})
        con_pase = sum(1 for v in estacion_dice.values() if v["con_pase_dia"])
        comprobaciones = [
            ("Clientes comparados", len(estacion_dice) >= 35 and len(estacion_dice) == len(servidor), f"{len(estacion_dice)} de {len(casos)}"),
            ("Pasa por los 8 estados", len(estados) == 8, ", ".join(estados)),
            ("Pasa por los 3 resultados", len(resultados) == 3, ", ".join(resultados)),
            ("Hay ingresos justificados por pase de día", con_pase >= 2, con_pase),
            ("El cliente eliminado no existe en ninguno de los dos", len(casos) - len(servidor) == 1, len(casos) - len(servidor)),
            ("Cero diferencias entre la estación y el servidor", not diferencias, len(diferencias)),
            ("Cada ingreso de la estación quedó en el servidor con su resultado", len(subidos) == len(registrados) and not mal_guardados, f"{len(subidos)} de {len(registrados)}"),
            ("Nada quedó por revisar: los dos decidieron lo mismo", not revisiones and informe["por_revisar_segun_la_estacion"] == 0, len(revisiones)),
            ("Ninguna operación rechazada", informe["con_error"] == 0, informe["con_error"]),
        ]
        print()
        ok = True
        for nombre, paso, dato in comprobaciones:
            ok = ok and bool(paso)
            print(f"  [{'OK' if paso else 'FALLA'}] {nombre} ({dato})")
        for descripcion, campo, s, e in diferencias:
            print(f"      DIFERENCIA en «{descripcion}» · {campo}: servidor={s!r} estación={e!r}")
        for fila in mal_guardados:
            print(f"      MAL GUARDADO «{fila[0]}»: estación={fila[1]!r} servidor={fila[2]!r}")
        for r in revisiones:
            print(f"      POR REVISAR: {r['motivo_codigo']} · {r['motivo']}")
        print(f"\nRESULTADO: {'PASÓ' if ok else 'FALLÓ'}")
        return 0 if ok else 1
    finally:
        if api is not None:
            api.terminate()
            try:
                api.wait(timeout=10)
            except subprocess.TimeoutExpired:
                api.kill()
        # Referencias con RESTRICT que la limpieza general no conoce: se borran antes.
        async with fabrica.admin_engine.begin() as conn:
            for g in fabrica.gimnasios:
                for tabla in ("sync_revisiones", "sync_operaciones", "venta_items", "ventas", "turnos_caja"):
                    await conn.execute(text(f"DELETE FROM platform.{tabla} WHERE gimnasio_id = :g"), {"g": g.id})
        await fabrica.limpiar()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
