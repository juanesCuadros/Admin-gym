def test_register_payment_and_cutting_date(client, superadmin_auth_headers):
    # 1. Create Gym
    gym_resp = client.post(
        "/api/v1/admin/gyms",
        json={
            "nombre": "Alpha Fitness",
            "jefe": {"nombre": "Pedro Jefe", "correo": "pedro@alphafit.com"},
            "suscripcion": {"valor_mensual": 120000.0, "tipo_inicio": "cliente_activo"}
        },
        headers=superadmin_auth_headers
    )
    gym_id = gym_resp.json()["gimnasio"]["id"]

    # 2. Register first payment of 2 months
    pay_resp = client.post(
        f"/api/v1/admin/gyms/{gym_id}/payments",
        json={
            "monto": 240000.0,
            "meses": 2,
            "metodo": "Transferencia Bancaria Bancolombia",
            "nota": "Pago bimestral inicial",
            "idempotency_key": "idem-key-test-001"
        },
        headers=superadmin_auth_headers
    )
    assert pay_resp.status_code == 201
    pay_data = pay_resp.json()
    assert pay_data["monto"] == 240000.0
    assert pay_data["meses"] == 2
    assert pay_data["nueva_fecha_corte"] is not None

    # 3. Duplicate Idempotency Key test (should raise 409 Conflict)
    dup_resp = client.post(
        f"/api/v1/admin/gyms/{gym_id}/payments",
        json={
            "monto": 240000.0,
            "meses": 2,
            "metodo": "Transferencia",
            "idempotency_key": "idem-key-test-001"
        },
        headers=superadmin_auth_headers
    )
    assert dup_resp.status_code == 409

    # 4. Void Payment (RF-18)
    payment_id = pay_data["id"]
    void_resp = client.post(
        f"/api/v1/admin/payments/{payment_id}/void",
        json={"motivo_anulacion": "Comprobante falso o rechazado por el banco"},
        headers=superadmin_auth_headers
    )
    assert void_resp.status_code == 200
    void_data = void_resp.json()
    assert void_data["anulado"] is True
    assert "Comprobante falso" in void_data["motivo_anulacion"]
