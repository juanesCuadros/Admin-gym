import asyncio
import os
import sys
from datetime import date, timedelta
from decimal import Decimal
from uuid import uuid4

# Asegurar path del proyecto
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(CURRENT_DIR, ".."))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

try:
    import pytest
    pytest_asyncio_mark = pytest.mark.asyncio
except ImportError:
    def pytest_asyncio_mark(f):
        return f

from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

from app.core.database import async_session_maker
from app.core.security import hash_password
from app.main import app


@pytest_asyncio_mark
async def test_cross_tenant_isolation_http():
    """
    Test Permanente de Aislamiento Multi-Tenant Cruzado (Cross-Tenant RLS).
    Verifica que:
    1. Dos tenants (Gym A y Gym B) se crean y configuran en PostgreSQL real.
    2. Jefe A y Jefe B obtienen tokens JWT independientes vía POST /api/v1/auth/login.
    3. Jefe A crea un deportista en Gym A.
    4. Jefe A puede consultar su deportista (200 OK).
    5. Jefe B (con JWT de Gym B) intenta:
       - GET /api/v1/deportistas/{id_a} -> Debe retornar 404 DEPORTISTA_NO_ENCONTRADO.
       - GET /api/v1/deportistas -> No debe incluir el ID ni nombre de Gym A.
       - GET /api/v1/deportistas?q=... -> Total 0 resultados.
       - PUT /api/v1/deportistas/{id_a} -> Debe retornar 404.
       - POST /api/v1/deportistas/{id_a}/suprimir-datos -> Debe retornar 404.
    """
    print("\n==================================================================")
    print("TEST PERMANENTE: AISLAMIENTO MULTI-TENANT CRUZADO (CROSS-TENANT RLS)")
    print("Destino: PostgreSQL real con RLS (gymos_db)")
    print("==================================================================")

    gym_a_id = uuid4()
    staff_jefe_a_id = uuid4()
    subdominio_a = f"gym-a-{uuid4().hex[:6]}"
    correo_jefe_a = f"jefe_a_{uuid4().hex[:6]}@gym.com"

    gym_b_id = uuid4()
    staff_jefe_b_id = uuid4()
    subdominio_b = f"gym-b-{uuid4().hex[:6]}"
    correo_jefe_b = f"jefe_b_{uuid4().hex[:6]}@gym.com"

    raw_pass = "Password123!"
    hashed_pass = hash_password(raw_pass)

    async with async_session_maker() as session:
        # Fixtures Gym A
        await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_a_id)})
        await session.execute(text("""
            INSERT INTO platform.tenant (id, nombre, subdominio, activo)
            VALUES (:id, 'Gimnasio A Alfa', :sub, true)
        """), {"id": gym_a_id, "sub": subdominio_a})

        await session.execute(text("""
            INSERT INTO platform.staff (id, gimnasio_id, nombre, correo, hash_password, rol, activo)
            VALUES (:id, :g_id, 'Jefe Gimnasio A', :correo, :h_pass, 'jefe', true)
        """), {"id": staff_jefe_a_id, "g_id": gym_a_id, "correo": correo_jefe_a, "h_pass": hashed_pass})
        await session.commit()

        # Fixtures Gym B
        await session.execute(text("SELECT set_config('app.gimnasio_id', :gym_id, true)"), {"gym_id": str(gym_b_id)})
        await session.execute(text("""
            INSERT INTO platform.tenant (id, nombre, subdominio, activo)
            VALUES (:id, 'Gimnasio B Beta', :sub, true)
        """), {"id": gym_b_id, "sub": subdominio_b})

        await session.execute(text("""
            INSERT INTO platform.staff (id, gimnasio_id, nombre, correo, hash_password, rol, activo)
            VALUES (:id, :g_id, 'Jefe Gimnasio B', :correo, :h_pass, 'jefe', true)
        """), {"id": staff_jefe_b_id, "g_id": gym_b_id, "correo": correo_jefe_b, "h_pass": hashed_pass})
        await session.commit()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Login independiente para ambos gimnasios
        r_login_a = await client.post("/api/v1/auth/login", json={
            "subdominio": subdominio_a,
            "correo": correo_jefe_a,
            "password": raw_pass
        })
        assert r_login_a.status_code == 200, f"Error login A: {r_login_a.text}"
        token_a = r_login_a.json()["access_token"]
        headers_a = {"Authorization": f"Bearer {token_a}"}

        r_login_b = await client.post("/api/v1/auth/login", json={
            "subdominio": subdominio_b,
            "correo": correo_jefe_b,
            "password": raw_pass
        })
        assert r_login_b.status_code == 200, f"Error login B: {r_login_b.text}"
        token_b = r_login_b.json()["access_token"]
        headers_b = {"Authorization": f"Bearer {token_b}"}
        print(" [PASS] Autenticación HTTP exitosa para Jefe A y Jefe B.")

        # 2. Jefe A crea un deportista en Gym A
        doc_dep_a = f"CC-A-{uuid4().hex[:6]}"
        nom_dep_a = "Atleta Privado Gym A"
        r_crear_a = await client.post("/api/v1/deportistas", json={
            "documento": doc_dep_a,
            "nombre": nom_dep_a,
            "correo": f"atleta_a_{uuid4().hex[:4]}@mail.com",
            "telefono": "3001234567",
            "consentimiento_1581": True
        }, headers=headers_a)
        assert r_crear_a.status_code == 201, f"Error crear deportista en Gym A: {r_crear_a.text}"
        dep_a_id = r_crear_a.json()["id"]
        print(f" [PASS] Deportista creado en Gym A (ID: {dep_a_id}, Doc: {doc_dep_a}).")

        # 3. Jefe A sí puede acceder a su propio deportista
        r_ver_a = await client.get(f"/api/v1/deportistas/{dep_a_id}", headers=headers_a)
        assert r_ver_a.status_code == 200
        assert r_ver_a.json()["deportista"]["documento"] == doc_dep_a
        print(" [PASS] Jefe A accede a su deportista legítimamente (200 OK).")

        # 4. PRUEBA CRUZADA 1: Jefe B intenta GET /deportistas/{id_a} -> Debe retornar 404
        r_cross_get = await client.get(f"/api/v1/deportistas/{dep_a_id}", headers=headers_b)
        assert r_cross_get.status_code == 404, (
            f"VIOLACIÓN CRÍTICA DE AISLAMIENTO: Gym B pudo ver deportista de Gym A! {r_cross_get.text}"
        )
        assert r_cross_get.json()["error"]["codigo"] == "DEPORTISTA_NO_ENCONTRADO"
        print(" [PASS] GET /deportistas/{id_a} con token de Gym B retornó 404 DEPORTISTA_NO_ENCONTRADO.")

        # 5. PRUEBA CRUZADA 2: Jefe B lista deportistas -> Ningún dato de Gym A debe filtrarse
        r_list_b = await client.get("/api/v1/deportistas", headers=headers_b)
        assert r_list_b.status_code == 200
        ids_en_b = [item["id"] for item in r_list_b.json()["items"]]
        assert dep_a_id not in ids_en_b, "VIOLACIÓN DE RLS: Deportista de Gym A apareció en el listado de Gym B!"

        r_search_b = await client.get(f"/api/v1/deportistas?q={nom_dep_a}", headers=headers_b)
        assert r_search_b.status_code == 200
        assert r_search_b.json()["total"] == 0, "VIOLACIÓN DE RLS: Búsqueda en Gym B devolvió deportista de Gym A!"
        print(" [PASS] Listado y búsqueda en Gym B no contienen registros de Gym A (0 fugas).")

        # 6. PRUEBA CRUZADA 3: Jefe B intenta modificar o suprimir deportista de Gym A -> 404
        r_put_b = await client.put(f"/api/v1/deportistas/{dep_a_id}", json={
            "nombre": "Alterado por Gym B",
            "version": 1
        }, headers=headers_b)
        assert r_put_b.status_code == 404, "VIOLACIÓN DE RLS: Gym B pudo editar deportista de Gym A!"

        r_del_b = await client.post(f"/api/v1/deportistas/{dep_a_id}/suprimir-datos", json={
            "motivo": "Ataque cross-tenant",
            "confirmar": True
        }, headers=headers_b)
        assert r_del_b.status_code == 404, "VIOLACIÓN DE RLS: Gym B pudo suprimir datos de deportista de Gym A!"
        print(" [PASS] Intentos de PUT y POST /suprimir-datos desde Gym B bloqueados con 404.")

    print("\n==================================================================")
    print(" AISLAMIENTO MULTI-TENANT CRUZADO 100% VERIFICADO EN POSTGRESQL REAL")
    print("==================================================================")


if __name__ == "__main__":
    asyncio.run(test_cross_tenant_isolation_http())
