"""
Criterio de terminado de la fase 3A de GymDesk Escritorio (aprobado por Juan el 22-nov-2026):

  Un día de caja sin red (turno, ventas, pago mixto y egresos). Al reconectar, el resumen del turno en el
  servidor es igual al de la estación, peso por peso y por medio de pago, sin duplicados, y el stock
  coincide. Dos conflictos provocados (turno simultáneo y stock negativo) terminan por revisar sin
  perder un solo movimiento.

Qué hace:
  1. Crea un gimnasio de prueba con Jefe, recepcionista, permisos, dos productos, un cliente y el precio
     del pase de día.
  2. Levanta la API del gimnasio (uvicorn) contra esa base y pide un código de estación como el Jefe.
  3. Corre la prueba de la estación (Rust): con red la web tiene la caja abierta y la estación no puede
     abrir; se cae la red, la estación abre igual, la web vende las últimas barras y la estación vende
     un día entero (incluida una barra), cierra con su arqueo y reconecta perdiendo una respuesta.
  4. Compara lo que dice la estación con lo que quedó en el servidor.
  5. Borra el gimnasio de prueba.

Uso (desde producto/gym-jefe-api, con su entorno virtual y DATABASE_URL / TEST_ADMIN_DATABASE_URL de tu base):
  .\\.venv\\Scripts\\python.exe ..\\gym-desk-escritorio\\pruebas\\prueba_caja.py

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
from uuid import uuid4

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

from app.core.database import async_session_maker  # noqa: E402
from app.modules.auth.service import AuthService  # noqa: E402
from tests.conftest import Fabrica  # noqa: E402
from tests.sync_util import sql  # noqa: E402

PRECIO_AGUA, PRECIO_BARRA, PRECIO_PASE_DIA = 3000, 5000, 15000


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


async def preparar(fabrica: Fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    recepcion = await fabrica.crear_staff(gym, rol="recepcionista")
    async with async_session_maker() as s:
        await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        await AuthService._seed_permisos_en_transaccion(s, gym.id)
        await s.commit()
    agua, barra, cliente, documento = uuid4(), uuid4(), uuid4(), uuid4().hex[:10]
    await sql(gym.id, "UPDATE platform.tenant SET precio_pase_dia = :p, metodos_pago = '[\"Efectivo\", \"Nequi\", \"Datáfono\"]'::jsonb WHERE id = :g",
              {"p": PRECIO_PASE_DIA, "g": gym.id})
    await sql(gym.id, "INSERT INTO platform.productos (id, gimnasio_id, nombre, precio, stock) VALUES (:id, :g, 'Agua', :p, 60)",
              {"id": agua, "g": gym.id, "p": PRECIO_AGUA})
    await sql(gym.id, "INSERT INTO platform.productos (id, gimnasio_id, nombre, precio, stock) VALUES (:id, :g, 'Barra de proteína', :p, 2)",
              {"id": barra, "g": gym.id, "p": PRECIO_BARRA})
    await sql(gym.id, """INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, activo)
                         VALUES (:id, :g, 'CC', :doc, 'Visitante de prueba', true)""", {"id": cliente, "g": gym.id, "doc": documento})
    # Fase 3B: un plan mensual, un socio cuya membresía vence en 5 días (comprada a 70.000) y uno sin membresía.
    plan, socio, nuevo, doc_nuevo = uuid4(), uuid4(), uuid4(), uuid4().hex[:10]
    await sql(gym.id, "INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo) VALUES (:id, :g, 'Mensual', 80000, 30, 'individual')",
              {"id": plan, "g": gym.id})
    for dep_id, nombre, doc in ((socio, "Socio que renueva", uuid4().hex[:10]), (nuevo, "Socio nuevo", doc_nuevo)):
        await sql(gym.id, """INSERT INTO platform.deportistas (id, gimnasio_id, tipo_documento, documento, nombre, activo)
                             VALUES (:id, :g, 'CC', :doc, :n, true)""", {"id": dep_id, "g": gym.id, "doc": doc, "n": nombre})
    await sql(gym.id, """INSERT INTO platform.membresias (gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, plan_precio_vendido)
                         VALUES (:g, :d, :p, (now() AT TIME ZONE 'America/Bogota')::date - 25, (now() AT TIME ZONE 'America/Bogota')::date + 5, 70000)""",
              {"g": gym.id, "d": socio, "p": plan})
    return gym, jefe, recepcion, str(agua), str(barra), str(cliente), documento, str(socio), str(nuevo), doc_nuevo


async def main() -> int:
    fabrica = Fabrica()
    api = None
    try:
        gym, jefe, recepcion, agua, barra, cliente, documento, socio, nuevo, doc_nuevo = await preparar(fabrica)
        print(f"Gimnasio de prueba: {gym.subdominio}")
        api = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(PUERTO), "--log-level", "warning"],
            cwd=API_DIR,
        )
        esperar_api(api)
        sesion = http("POST", "/auth/login", {"subdominio": gym.subdominio, "correo": jefe["correo"], "password": jefe["password"]})
        token = sesion["access_token"]
        estacion = http("POST", "/estaciones", {"nombre": "Recepción (prueba de caja)"}, token)

        salida = Path(tempfile.gettempdir()) / f"gymdesk_caja_{gym.subdominio}.json"
        entorno = {
            **os.environ,
            "GYMDESK_API_URL": API,
            "GYMDESK_PRUEBA_SUBDOMINIO": gym.subdominio,
            "GYMDESK_PRUEBA_CODIGO": estacion["codigo"],
            "GYMDESK_PRUEBA_CORREO": recepcion["correo"],
            "GYMDESK_PRUEBA_TOKEN_JEFE": token,
            "GYMDESK_PRUEBA_CLIENTE": cliente,
            "GYMDESK_PRUEBA_DOCUMENTO": documento,
            "GYMDESK_PRUEBA_AGUA": agua,
            "GYMDESK_PRUEBA_BARRA": barra,
            "GYMDESK_PRUEBA_SOCIO": socio,
            "GYMDESK_PRUEBA_SOCIO_NUEVO": nuevo,
            "GYMDESK_PRUEBA_DOC_NUEVO": doc_nuevo,
            "GYMDESK_PRUEBA_SALIDA": str(salida),
        }
        inicio = time.time()
        rust = subprocess.run(
            ["cargo", "test", "--color", "never", "-j", "3", "un_dia_de_caja_sin_red", "--", "--ignored", "--nocapture"],
            cwd=ESCRITORIO / "src-tauri", env=entorno, capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        lineas = [l for l in (rust.stdout + rust.stderr).splitlines() if "LNK4099" not in l and "ossl_static" not in l]
        print("\n".join(l for l in lineas if l.startswith("test ") or "panicked" in l or "left:" in l or "right:" in l))
        if rust.returncode != 0 or not salida.exists():
            print("\n".join(lineas[-30:]))
            print("\nRESULTADO: FALLÓ la prueba de la estación")
            return 1
        inf = json.loads(salida.read_text(encoding="utf-8"))
        salida.unlink()

        # --- Lo que quedó en el servidor ---
        t_id = inf["turno_estacion"]
        turno_srv = (await sql(gym.id, """
            SELECT t.estado, t.estacion_id IS NOT NULL AS de_estacion, round(t.base_inicial)::bigint AS base,
                   round(t.efectivo_contado)::bigint AS contado, round(t.diferencia)::bigint AS diferencia
            FROM platform.turnos_caja t WHERE t.id = :t""", {"t": t_id}))[0]
        por_medio_srv = await sql(gym.id, """
            SELECT metodo, tipo_medio, round(sum(monto))::bigint AS monto FROM (
              SELECT v.metodo, v.tipo_medio, v.total AS monto FROM platform.ventas v WHERE v.turno_id = :t AND v.tipo_medio <> 'mixto'
              UNION ALL
              SELECT m.metodo, m.tipo_medio, m.monto FROM platform.cobro_medios m JOIN platform.ventas v ON v.id = m.venta_id WHERE v.turno_id = :t
              UNION ALL
              SELECT p.metodo, p.tipo_medio, p.monto FROM platform.pagos_membresia p WHERE p.turno_id = :t AND p.tipo_medio <> 'mixto'
              UNION ALL
              SELECT m.metodo, m.tipo_medio, m.monto FROM platform.cobro_medios m JOIN platform.pagos_membresia p ON p.id = m.pago_membresia_id WHERE p.turno_id = :t
            ) x GROUP BY metodo, tipo_medio""", {"t": t_id})
        pagos_srv = (await sql(gym.id, "SELECT count(*) n, count(DISTINCT id) d FROM platform.pagos_membresia WHERE turno_id = :t", {"t": t_id}))[0]
        vence_srv = {f["id"]: f["v"] for f in await sql(
            gym.id, "SELECT id::text, fecha_vencimiento::text AS v FROM platform.membresias WHERE deportista_id IN (:a, :b)", {"a": socio, "b": nuevo})}
        egresos_srv = (await sql(gym.id, "SELECT count(*) n, coalesce(round(sum(monto))::bigint, 0) s FROM platform.egresos_caja WHERE turno_id = :t", {"t": t_id}))[0]
        ventas_srv = (await sql(gym.id, "SELECT count(*) n, count(DISTINCT id) d FROM platform.ventas WHERE turno_id = :t", {"t": t_id}))[0]
        recibidas = await sql(gym.id, "SELECT operacion_id::text AS id FROM platform.sync_operaciones ORDER BY id")
        revisiones = await sql(gym.id, "SELECT entidad, entidad_id, motivo_codigo FROM platform.sync_revisiones ORDER BY created_at")
        stock_srv = {f["id"]: f["stock"] for f in await sql(gym.id, "SELECT id::text, stock FROM platform.productos")}
        turno_web = (await sql(gym.id, """
            SELECT t.estado, round(t.diferencia)::bigint AS diferencia, (SELECT count(*) FROM platform.ventas v WHERE v.turno_id = t.id) AS ventas
            FROM platform.turnos_caja t WHERE t.id = :t""", {"t": inf["turno_web"]}))[0]
        cadena = await sql(gym.id, """SELECT count(*) AS rotas FROM (
                 SELECT hash_previo, lag(hash_actual) OVER (ORDER BY id) AS anterior FROM platform.auditoria_gym
               ) x WHERE anterior IS NOT NULL AND hash_previo <> anterior""")

        # El resumen del servidor se calcula con la misma función que usa la web (/caja/turnos).
        async with async_session_maker() as s:
            await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
            from app.modules.caja.service import CajaService
            fila = dict((await s.execute(text("SELECT * FROM platform.turnos_caja WHERE id = :t"), {"t": t_id})).mappings().one())
            r = await CajaService._calcular_acumulados_turno(s, fila)
        srv = {"base_inicial": int(r.base_inicial), "ventas_efectivo": int(r.ventas_efectivo), "ventas_otro": int(r.ventas_otro),
               "membresias_efectivo": int(r.pagos_membresia_efectivo), "membresias_otro": int(r.pagos_membresia_otro),
               "egresos_efectivo": int(r.egresos_efectivo), "total_esperado_efectivo": int(r.total_esperado_efectivo)}
        loc = {k: inf["totales"][k] for k in srv}

        medios_loc = {(p["metodo"], p["tipo_medio"]): p["monto"] for p in inf["totales"]["por_metodo"]}
        medios_srv = {(p["metodo"], p["tipo_medio"]): p["monto"] for p in por_medio_srv}
        ids_est, ids_srv = inf["ids"], [f["id"] for f in recibidas]
        codigos = sorted(r["motivo_codigo"] for r in revisiones)
        stock_ok = all(stock_srv[p] == inf["stock"][p] == inf["disponible"][p] for p in (agua, barra))
        vendidas_agua = 60 - stock_srv[agua]

        comprobaciones = [
            ("Resumen del turno igual peso por peso (base, efectivo, otros medios, egresos, esperado)", srv == loc, f"{srv} vs {loc}"),
            ("Igual por medio de pago", medios_srv == medios_loc, sorted(medios_srv.items())),
            ("Arqueo igual: contado y diferencia", (turno_srv["contado"], turno_srv["diferencia"]) == (inf["turno"]["efectivo_contado"], inf["turno"]["diferencia"]),
             (turno_srv["contado"], turno_srv["diferencia"])),
            ("El turno de la estación quedó cerrado y marcado como de estación", turno_srv["estado"] == "cerrado" and turno_srv["de_estacion"], turno_srv["estado"]),
            ("Mismas ventas, sin duplicados", ventas_srv["n"] == ventas_srv["d"] == inf["ventas"], ventas_srv["n"]),
            ("Membresías: una renovación y una venta, sin duplicados", pagos_srv["n"] == pagos_srv["d"] == inf["totales"]["num_membresias"] == 2, pagos_srv["n"]),
            ("Mismas fechas de vencimiento en la estación y en el servidor", vence_srv == inf["vencimientos"], f"{vence_srv} vs {inf['vencimientos']}"),
            ("Mismos egresos", (egresos_srv["n"], egresos_srv["s"]) == (inf["egresos"], inf["totales"]["egresos_efectivo"]), egresos_srv["n"]),
            ("El servidor recibió cada operación una sola vez", len(ids_srv) == len(set(ids_srv)) == len(ids_est) and set(ids_srv) == set(ids_est), len(ids_srv)),
            ("Stock igual en la estación y en el servidor", stock_ok, {"agua": stock_srv[agua], "barra": stock_srv[barra]}),
            ("La barra quedó en −1 y el agua bajó lo vendido", stock_srv[barra] == -1 and vendidas_agua == 40, (stock_srv[barra], vendidas_agua)),
            ("Dos conflictos por revisar: turno simultáneo y stock negativo", codigos == ["STOCK_NEGATIVO", "TURNO_SIMULTANEO"], codigos),
            ("La estación ve los mismos dos por revisar", sorted(c for _, c in inf["revisiones"]) == codigos, inf["revisiones"]),
            ("El turno simultáneo de la web no perdió nada y cerró con su arqueo", turno_web["estado"] == "cerrado" and turno_web["ventas"] == 1 and turno_web["diferencia"] == 0,
             turno_web),
            ("Cadena de auditoría del servidor íntegra", cadena[0]["rotas"] == 0, cadena[0]["rotas"]),
            ("Auditoría local íntegra", inf["auditoria_local_integra"], "-"),
        ]
        print(f"\nDía simulado en {time.time() - inicio:.0f} s reales · en cola al reconectar: {inf['en_cola_al_reconectar']} operaciones")
        esperado = f"{loc['total_esperado_efectivo']:,}".replace(",", ".")
        print(f"Turno de la estación: {inf['ventas']} ventas, {inf['egresos']} egresos, efectivo esperado {esperado}")
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
        async with fabrica.admin_engine.begin() as conn:
            for g in fabrica.gimnasios:
                await conn.execute(text("DELETE FROM platform.sync_revisiones WHERE gimnasio_id = :g"), {"g": g.id})
                await conn.execute(text("DELETE FROM platform.sync_operaciones WHERE gimnasio_id = :g"), {"g": g.id})
        await fabrica.limpiar()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
