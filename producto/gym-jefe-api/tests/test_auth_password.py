"""
Tanda 1.5 · punto 4 · Cambio de contraseña con sesión y contraseña temporal (GW-RF-00.1 CA3).
"""
from tests.conftest import en_horas, login


def _auth(access: str) -> dict:
    return {"Authorization": f"Bearer {access}"}


async def test_cambiar_password_cierra_las_demas_sesiones_pero_no_la_actual(cliente, fabrica):
    """Prueba 5 del enunciado."""
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)

    otra = (await login(cliente, gym, st)).json()          # sesión en otro dispositivo
    actual = (await login(cliente, gym, st)).json()        # sesión desde la que se cambia

    r = await cliente.post(
        "/api/v1/auth/cambiar-password",
        json={"password_actual": st["password"], "password_nueva": "Clave-Nueva-2026"},
        headers=_auth(actual["access_token"]),
    )
    assert r.status_code == 200, r.text

    # La otra sesión murió; la actual sigue pudiendo refrescar
    assert (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": otra["refresh_token"]})).status_code == 401
    assert (await cliente.post("/api/v1/auth/refresh", json={"refresh_token": actual["refresh_token"]})).status_code == 200

    assert (await login(cliente, gym, st, password="Clave-Nueva-2026")).status_code == 200
    assert (await login(cliente, gym, st)).status_code == 401


async def test_rechaza_nueva_igual_a_actual_y_actual_incorrecta(cliente, fabrica):
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym)
    access = (await login(cliente, gym, st)).json()["access_token"]

    r = await cliente.post(
        "/api/v1/auth/cambiar-password",
        json={"password_actual": st["password"], "password_nueva": st["password"]},
        headers=_auth(access),
    )
    assert r.status_code == 400 and r.json()["error"]["codigo"] == "PASSWORD_IGUAL_A_ACTUAL"

    r = await cliente.post(
        "/api/v1/auth/cambiar-password",
        json={"password_actual": "no-es-esta", "password_nueva": "Clave-Nueva-2026"},
        headers=_auth(access),
    )
    assert r.status_code == 400 and r.json()["error"]["codigo"] == "PASSWORD_ACTUAL_INCORRECTA"


async def test_temporal_vigente_entra_con_flag_y_al_cambiarla_se_limpia(cliente, fabrica):
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym, debe_cambiar_password=True, password_temporal_expira_en=en_horas(48))

    body = (await login(cliente, gym, st)).json()
    assert body["usuario"]["debe_cambiar_password"] is True
    assert body["usuario"]["password_temporal_expira_en"] is not None

    me = (await cliente.get("/api/v1/auth/me", headers=_auth(body["access_token"]))).json()
    assert me["debe_cambiar_password"] is True

    r = await cliente.post(
        "/api/v1/auth/cambiar-password",
        json={"password_actual": st["password"], "password_nueva": "Definitiva-2026"},
        headers=_auth(body["access_token"]),
    )
    assert r.status_code == 200, r.text

    me = (await cliente.get("/api/v1/auth/me", headers=_auth(body["access_token"]))).json()
    assert me["debe_cambiar_password"] is False and me["password_temporal_expira_en"] is None


async def test_temporal_vencida_devuelve_codigo_propio(cliente, fabrica):
    """Prueba 6 del enunciado."""
    gym = await fabrica.crear_gimnasio()
    st = await fabrica.crear_staff(gym, debe_cambiar_password=True, password_temporal_expira_en=en_horas(-1))

    r = await login(cliente, gym, st)
    assert r.status_code == 401
    assert r.json()["error"]["codigo"] == "PASSWORD_TEMPORAL_VENCIDA"

    # No cuenta como intento fallido: 6 intentos seguidos no bloquean la cuenta
    for _ in range(6):
        assert (await login(cliente, gym, st)).json()["error"]["codigo"] == "PASSWORD_TEMPORAL_VENCIDA"


async def test_jefe_con_credencial_del_superadmin_sin_cambiar(cliente, fabrica):
    """El estado temporal del Jefe vive en el Super-Admin (cuentas_jefe + emisiones_credenciales)."""
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    await fabrica.crear_cuenta_jefe_superadmin(gym, jefe["correo"], password_cambiada=False, emision_expira_en=en_horas(24))

    body = (await login(cliente, gym, jefe)).json()
    assert body["usuario"]["debe_cambiar_password"] is True

    r = await cliente.post(
        "/api/v1/auth/cambiar-password",
        json={"password_actual": jefe["password"], "password_nueva": "Jefe-Definitiva-2026"},
        headers=_auth(body["access_token"]),
    )
    assert r.status_code == 200, r.text
    me = (await cliente.get("/api/v1/auth/me", headers=_auth(body["access_token"]))).json()
    assert me["debe_cambiar_password"] is False


async def test_jefe_con_credencial_del_superadmin_vencida(cliente, fabrica):
    gym = await fabrica.crear_gimnasio()
    jefe = await fabrica.crear_staff(gym, rol="jefe")
    await fabrica.crear_cuenta_jefe_superadmin(gym, jefe["correo"], password_cambiada=False, emision_expira_en=en_horas(-2))

    r = await login(cliente, gym, jefe)
    assert r.status_code == 401 and r.json()["error"]["codigo"] == "PASSWORD_TEMPORAL_VENCIDA"
