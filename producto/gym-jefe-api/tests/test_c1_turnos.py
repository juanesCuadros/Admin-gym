import pytest
import uuid
from decimal import Decimal
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import create_access_token, hash_password
from app.main import app
from app.modules.auth.service import AuthService


@pytest.mark.asyncio
async def test_c1_turno_unico_y_cierre_ajeno():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        prefix = uuid.uuid4().hex[:6]
        gym_id = uuid.uuid4()
        recep1_id = uuid.uuid4()
        recep2_id = uuid.uuid4()
        pwd_hash = hash_password("ClaveSegura123!")

        async with async_session_maker() as session:
            await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_id)})
            await session.execute(text("""
                INSERT INTO platform.tenant (id, nombre, subdominio, activo)
                VALUES (:id, :nom, :sub, true)
            """), {"id": gym_id, "nom": f"Gym C1 {prefix}", "sub": f"c1-{prefix}"})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'recepcionista', :mail, :pwd, 'Recepcionista Uno', true)
            """), {"id": recep1_id, "gym": gym_id, "mail": f"recep1_{prefix}@test.com", "pwd": pwd_hash})

            await session.execute(text("""
                INSERT INTO platform.staff (id, gimnasio_id, rol, correo, hash_password, nombre, activo)
                VALUES (:id, :gym, 'recepcionista', :mail, :pwd, 'Recepcionista Dos', true)
            """), {"id": recep2_id, "gym": gym_id, "mail": f"recep2_{prefix}@test.com", "pwd": pwd_hash})

            await AuthService._seed_permisos_en_transaccion(session, gym_id)
            await session.commit()

        # Tokens
        tok_recep1 = create_access_token(str(recep1_id), str(gym_id), "recepcionista")
        tok_recep2 = create_access_token(str(recep2_id), str(gym_id), "recepcionista")
        h_recep1 = {"Authorization": f"Bearer {tok_recep1}"}
        h_recep2 = {"Authorization": f"Bearer {tok_recep2}"}

        # 1. Sin turno abierto -> 404
        r = await client.get("/api/v1/caja/turnos/actual", headers=h_recep1)
        assert r.status_code == 404
        assert r.json()["error"]["codigo"] == "NO_HAY_TURNO_ABIERTO"

        # 2. Recepcionista 1 abre turno
        r_abrir = await client.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 50000}, headers=h_recep1)
        assert r_abrir.status_code == 201
        data_abrir = r_abrir.json()
        turno_id = data_abrir["id"]
        assert data_abrir["estado"] == "abierto"
        assert data_abrir["es_propio"] is True
        assert data_abrir["abierto_por_nombre"] == "Recepcionista Uno"

        # 3. Recepcionista 1 intenta abrir otro turno propio -> 409 TURNO_YA_ABIERTO
        r_reabrir_propio = await client.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 20000}, headers=h_recep1)
        assert r_reabrir_propio.status_code == 409
        assert r_reabrir_propio.json()["error"]["codigo"] == "TURNO_YA_ABIERTO"

        # 4. Recepcionista 2 intenta abrir turno -> 409 TURNO_AJENO_ABIERTO (GW-RF-08, Contrato 1.1)
        r_abrir_ajeno = await client.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 30000}, headers=h_recep2)
        assert r_abrir_ajeno.status_code == 409
        err_ajeno = r_abrir_ajeno.json()["error"]
        assert err_ajeno["codigo"] == "TURNO_AJENO_ABIERTO"
        assert err_ajeno["detalles"]["turno_id"] == turno_id
        assert err_ajeno["detalles"]["abierto_por_nombre"] == "Recepcionista Uno"
        assert "abierto_en" in err_ajeno["detalles"]

        # 5. Consultar turno actual desde Recepcionista 2 -> es_propio=False
        r_act2 = await client.get("/api/v1/caja/turnos/actual", headers=h_recep2)
        assert r_act2.status_code == 200
        data_act2 = r_act2.json()
        assert data_act2["id"] == turno_id
        assert data_act2["es_propio"] is False
        assert data_act2["abierto_por_nombre"] == "Recepcionista Uno"

        # 6. Recepcionista 2 cierra el turno ajeno de Recepcionista 1 (POST /caja/turnos/{turno_id}/cerrar-ajeno)
        r_cerrar_ajeno = await client.post(
            f"/api/v1/caja/turnos/{turno_id}/cerrar-ajeno",
            json={"conteo_efectivo": 48000, "nota": "Turno dejado sin cerrar por R1, descuadre de 2000"},
            headers=h_recep2
        )
        assert r_cerrar_ajeno.status_code == 200
        data_cierre = r_cerrar_ajeno.json()
        assert data_cierre["estado"] == "cerrado"
        assert data_cierre["cerrado_por_nombre"] == "Recepcionista Dos"
        assert data_cierre["descuadre_atribuido_a_nombre"] == "Recepcionista Uno"
        assert Decimal(str(data_cierre["diferencia"])) == Decimal("-2000.00")

        # 7. Verificar en base de datos que se persistió cerrado_por y nota_cierre
        async with async_session_maker() as session:
            q = text("SELECT cerrado_por, nota_cierre FROM platform.turnos_caja WHERE id = :id")
            res_db = await session.execute(q, {"id": turno_id})
            row_db = res_db.mappings().one()
            assert str(row_db["cerrado_por"]) == str(recep2_id)
            assert "Turno dejado sin cerrar por R1" in row_db["nota_cierre"]

        # 8. Ya no hay turno abierto -> 404
        r_sin_turno = await client.get("/api/v1/caja/turnos/actual", headers=h_recep2)
        assert r_sin_turno.status_code == 404

        # 9. Ahora Recepcionista 2 puede abrir su turno propio exitosamente
        r_abrir2 = await client.post("/api/v1/caja/turnos/abrir", json={"base_inicial": 40000}, headers=h_recep2)
        assert r_abrir2.status_code == 201
        data_abrir2 = r_abrir2.json()
        assert data_abrir2["estado"] == "abierto"
        assert data_abrir2["es_propio"] is True
        assert data_abrir2["abierto_por_nombre"] == "Recepcionista Dos"
