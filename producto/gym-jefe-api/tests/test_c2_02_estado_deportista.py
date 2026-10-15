import pytest
from datetime import date, timedelta
from uuid import uuid4
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.timezone import today_local
from app.modules.membresias.domain import MembresiaDomainService
from tests.conftest import Gimnasio, login


def test_evaluar_estado_puro_los_8_estados():
    """Valida los 8 estados del enum consolidado en MembresiaDomainService."""
    hoy = today_local()

    # 1. Desactivado
    res = MembresiaDomainService.evaluar_estado_puro(
        hoy=hoy,
        activo_deportista=False,
        tiene_membresia=True,
        fecha_vencimiento=hoy + timedelta(days=20),
    )
    assert res.estado == "desactivado"
    assert res.permite_ingreso is False
    assert res.resultado_acceso == "negado"

    # 2. Cancelado
    res = MembresiaDomainService.evaluar_estado_puro(
        hoy=hoy,
        activo_deportista=True,
        tiene_membresia=False,
        ultima_cancelada=True,
    )
    assert res.estado == "cancelado"
    assert res.permite_ingreso is False
    assert res.resultado_acceso == "negado"

    # 3. Sin membresía
    res = MembresiaDomainService.evaluar_estado_puro(
        hoy=hoy,
        activo_deportista=True,
        tiene_membresia=False,
        ultima_cancelada=False,
    )
    assert res.estado == "sin_membresia"
    assert res.permite_ingreso is False
    assert res.resultado_acceso == "negado"

    # 4. Congelado (incluso con membresía vencida, CA4)
    res = MembresiaDomainService.evaluar_estado_puro(
        hoy=hoy,
        activo_deportista=True,
        tiene_membresia=True,
        fecha_vencimiento=hoy - timedelta(days=10),
        congelamiento_activo=True,
    )
    assert res.estado == "congelado"
    assert res.permite_ingreso is False
    assert res.resultado_acceso == "negado"

    # 5. Vencido (con g=3 y vencimiento hace 4 días, CA2)
    res = MembresiaDomainService.evaluar_estado_puro(
        hoy=hoy,
        activo_deportista=True,
        tiene_membresia=True,
        fecha_vencimiento=hoy - timedelta(days=4),
        dias_gracia_mora=3,
    )
    assert res.estado == "vencido"
    assert res.permite_ingreso is False
    assert res.resultado_acceso == "negado"

    # 6. En gracia (con g=3 y vencimiento ayer, CA1)
    res = MembresiaDomainService.evaluar_estado_puro(
        hoy=hoy,
        activo_deportista=True,
        tiene_membresia=True,
        fecha_vencimiento=hoy - timedelta(days=1),
        dias_gracia_mora=3,
    )
    assert res.estado == "en_gracia"
    assert res.permite_ingreso is True
    assert res.resultado_acceso == "alerta_mora"

    # 7. Por vencer (vence en 3 días con p=5)
    res = MembresiaDomainService.evaluar_estado_puro(
        hoy=hoy,
        activo_deportista=True,
        tiene_membresia=True,
        fecha_vencimiento=hoy + timedelta(days=3),
        dias_umbral_por_vencer=5,
    )
    assert res.estado == "por_vencer"
    assert res.permite_ingreso is True
    assert res.resultado_acceso == "abrio"

    # 8. Activo (vence en 20 días con p=5)
    res = MembresiaDomainService.evaluar_estado_puro(
        hoy=hoy,
        activo_deportista=True,
        tiene_membresia=True,
        fecha_vencimiento=hoy + timedelta(days=20),
        dias_umbral_por_vencer=5,
    )
    assert res.estado == "activo"
    assert res.permite_ingreso is True
    assert res.resultado_acceso == "abrio"


@pytest.mark.asyncio
async def test_endpoints_usan_estado_unico_consolidado(cliente: AsyncClient, fabrica):
    """Verifica que lista, búsqueda, ficha y checkin exponen 'estado' y ningún al_dia/en_mora/mora/inactivo."""
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    tok = (await login(cliente, gym, jefe)).json()["access_token"]
    headers = {"Authorization": f"Bearer {tok}"}

    hoy = today_local()
    plan_id = uuid4()
    dep_activo_id = uuid4()
    dep_gracia_id = uuid4()
    dep_inactivo_id = uuid4()

    async with async_session_maker() as s:
        await s.execute(text("SELECT set_config('app.gimnasio_id', :g, true)"), {"g": str(gym.id)})
        # Plan
        await s.execute(
            text("""
                INSERT INTO platform.planes (id, gimnasio_id, nombre, precio, duracion_dias, tipo)
                VALUES (:id, :g, 'Plan Oro', 100000, 30, 'individual')
            """),
            {"id": plan_id, "g": gym.id},
        )
        # Deportista 1: Activo
        await s.execute(
            text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :g, '11111111', 'Deportista Activo', true, now(), true)
            """),
            {"id": dep_activo_id, "g": gym.id},
        )
        await s.execute(
            text("""
                INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento)
                VALUES (gen_random_uuid(), :g, :dep, :plan, :ini, :venc)
            """),
            {"g": gym.id, "dep": dep_activo_id, "plan": plan_id, "ini": hoy - timedelta(days=5), "venc": hoy + timedelta(days=25)},
        )
        # Deportista 2: En Gracia
        await s.execute(
            text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :g, '22222222', 'Deportista Gracia', true, now(), true)
            """),
            {"id": dep_gracia_id, "g": gym.id},
        )
        await s.execute(
            text("""
                INSERT INTO platform.membresias (id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento)
                VALUES (gen_random_uuid(), :g, :dep, :plan, :ini, :venc)
            """),
            {"g": gym.id, "dep": dep_gracia_id, "plan": plan_id, "ini": hoy - timedelta(days=31), "venc": hoy - timedelta(days=1)},
        )
        # Deportista 3: Desactivado
        await s.execute(
            text("""
                INSERT INTO platform.deportistas (id, gimnasio_id, documento, nombre, consentimiento_1581, consentimiento_fecha, activo)
                VALUES (:id, :g, '33333333', 'Deportista Desactivado', true, now(), false)
            """),
            {"id": dep_inactivo_id, "g": gym.id},
        )
        await s.commit()

    # 1. GET /deportistas (lista)
    r_list = await cliente.get("/api/v1/deportistas", headers=headers)
    assert r_list.status_code == 200
    items = r_list.json()["items"]
    items_by_id = {item["id"]: item for item in items}
    
    assert items_by_id[str(dep_activo_id)]["estado"] == "activo"
    assert items_by_id[str(dep_gracia_id)]["estado"] == "en_gracia"
    assert items_by_id[str(dep_inactivo_id)]["estado"] == "desactivado"
    # Ningún estado_membresia en la respuesta
    for item in items:
        assert "estado_membresia" not in item
        assert item["estado"] not in ["al_dia", "en_mora", "mora", "inactivo"]

    # 2. GET /deportistas/buscar
    r_search = await cliente.get("/api/v1/deportistas/buscar?q=Deportista", headers=headers)
    assert r_search.status_code == 200
    s_items = r_search.json()
    for s_item in s_items:
        assert "estado" in s_item
        assert "estado_membresia" not in s_item
        assert s_item["estado"] in ["desactivado", "cancelado", "sin_membresia", "congelado", "vencido", "en_gracia", "por_vencer", "activo"]

    # 3. GET /deportistas/{id} (ficha)
    r_ficha = await cliente.get(f"/api/v1/deportistas/{dep_activo_id}", headers=headers)
    assert r_ficha.status_code == 200
    f_data = r_ficha.json()
    assert f_data["deportista"]["estado"] == "activo"
    assert f_data["membresia_actual"]["estado"] == "activo"

    # Ficha del que está en gracia
    r_ficha_g = await cliente.get(f"/api/v1/deportistas/{dep_gracia_id}", headers=headers)
    assert r_ficha_g.status_code == 200
    f_data_g = r_ficha_g.json()
    assert f_data_g["deportista"]["estado"] == "en_gracia"
    assert f_data_g["membresia_actual"]["estado"] == "en_gracia"

    # 4. POST /control-ingreso/checkin-manual
    r_checkin = await cliente.post(
        "/api/v1/control-ingreso/checkin-manual",
        json={"deportista_id": str(dep_gracia_id)},
        headers=headers,
    )
    assert r_checkin.status_code == 200
    ck_data = r_checkin.json()
    assert ck_data["deportista"]["estado"] == "en_gracia"
    assert ck_data["resultado"] == "alerta_mora"
