def test_check_subdomain_availability(client, superadmin_auth_headers):
    response = client.get(
        "/api/v1/admin/gyms/check-subdomain?subdomain=smart-fitness",
        headers=superadmin_auth_headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["disponible"] is True
    assert data["valido"] is True

def test_create_gym_assisted_provisioning(client, superadmin_auth_headers):
    payload = {
        "nombre": "Spartan Gym",
        "subdominio": "spartan-gym",
        "nit": "900123456-1",
        "ciudad": "Bogotá",
        "telefono": "+573001234567",
        "jefe": {
            "nombre": "Carlos Spartan",
            "correo": "carlos@spartangym.com",
            "telefono": "+573009876543"
        },
        "suscripcion": {
            "valor_mensual": 150000.0,
            "tipo_inicio": "prueba"
        }
    }

    response = client.post("/api/v1/admin/gyms", json=payload, headers=superadmin_auth_headers)
    assert response.status_code == 201
    data = response.json()

    # Verify Gym entity
    assert data["gimnasio"]["nombre"] == "Spartan Gym"
    assert data["gimnasio"]["subdominio"] == "spartan-gym"
    assert data["gimnasio"]["estado"] == "prueba"
    assert data["gimnasio"]["fecha_corte"] is not None  # 5 days trial

    # Verify Single-View Credentials block (RF-11)
    creds = data["credenciales"]
    assert creds["correo_jefe"] == "carlos@spartangym.com"
    assert "password_temporal" in creds
    assert len(creds["password_temporal"]) >= 10
    assert "whatsapp_copiable" in creds
    assert "spartan-gym" in creds["url_acceso"]

def test_gym_lifecycle_and_state_transitions(client, superadmin_auth_headers):
    # 1. Create gym in prueba
    create_payload = {
        "nombre": "Titanium Fitness",
        "jefe": {"nombre": "Laura Jefe", "correo": "laura@titanium.com"},
        "suscripcion": {"valor_mensual": 200000.0, "tipo_inicio": "prueba"}
    }
    create_resp = client.post("/api/v1/admin/gyms", json=create_payload, headers=superadmin_auth_headers)
    assert create_resp.status_code == 201
    gym_id = create_resp.json()["gimnasio"]["id"]

    # 2. Transition prueba -> activo
    st_resp = client.patch(
        f"/api/v1/admin/gyms/{gym_id}/status",
        json={"nuevo_estado": "activo"},
        headers=superadmin_auth_headers
    )
    assert st_resp.status_code == 200
    assert st_resp.json()["estado"] == "activo"

    # 3. Transition activo -> suspendido
    st_resp2 = client.patch(
        f"/api/v1/admin/gyms/{gym_id}/status",
        json={"nuevo_estado": "suspendido"},
        headers=superadmin_auth_headers
    )
    assert st_resp2.status_code == 200
    assert st_resp2.json()["estado"] == "suspendido"

    # 4. Formal cancellation (RF-10)
    cancel_resp = client.post(
        f"/api/v1/admin/gyms/{gym_id}/cancel",
        json={"motivo": "Cierre definitivo de la sede por cambio de actividad comercial"},
        headers=superadmin_auth_headers
    )
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["estado"] == "cancelado"
    assert "Cierre definitivo" in cancel_resp.json()["motivo_cancelacion"]
