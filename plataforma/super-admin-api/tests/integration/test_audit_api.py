def test_audit_log_and_chain_verification_api(client, superadmin_auth_headers):
    # Perform an action that triggers audit log: create a gym
    client.post(
        "/api/v1/admin/gyms",
        json={
            "nombre": "Audit Test Gym",
            "jefe": {"nombre": "Audit Jefe", "correo": "audit@gym.com"},
            "suscripcion": {"valor_mensual": 100000.0, "tipo_inicio": "prueba"}
        },
        headers=superadmin_auth_headers
    )

    # 1. Query audit log list
    audit_resp = client.get("/api/v1/admin/audit", headers=superadmin_auth_headers)
    assert audit_resp.status_code == 200
    logs = audit_resp.json()
    assert len(logs) >= 1
    assert any(l["accion"] == "CREACION_GIMNASIO_PROVISIONING" for l in logs)

    # 2. Verify chain cryptographic integrity
    verify_resp = client.get("/api/v1/admin/audit/verify-chain", headers=superadmin_auth_headers)
    assert verify_resp.status_code == 200
    verify_data = verify_resp.json()
    assert verify_data["cadena_integra"] is True
    assert verify_data["primer_registro_corrupto_id"] is None
