def test_create_and_filter_exercises(client, superadmin_auth_headers):
    payload = {
        "nombre_es": "Press de Banca Plano",
        "nombre_en": "Flat Bench Press",
        "grupo_muscular": "Pecho",
        "equipo": "Barra Olímpica",
        "categoria": "Fuerza",
        "instrucciones": "Bajar la barra controlada al esternón y empujar con firmeza.",
        "activo": True
    }
    resp = client.post("/api/v1/admin/exercises", json=payload, headers=superadmin_auth_headers)
    assert resp.status_code == 201
    ex_id = resp.json()["id"]

    # Filter
    list_resp = client.get("/api/v1/admin/exercises?grupo_muscular=Pecho", headers=superadmin_auth_headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1
    assert any(e["nombre_es"] == "Press de Banca Plano" for e in list_resp.json())

    # Toggle status
    toggle_resp = client.patch(
        f"/api/v1/admin/exercises/{ex_id}/status",
        json={"activo": False},
        headers=superadmin_auth_headers
    )
    assert toggle_resp.status_code == 200
    assert toggle_resp.json()["activo"] is False

def test_import_exercise_dataset(client, superadmin_auth_headers):
    import_payload = {
        "dataset_nombre": "Wger GymOS Baseline v1",
        "modo_actualizacion": True,
        "ejercicios": [
            {
                "nombre_es": "Sentadilla Libre",
                "nombre_en": "Barbell Squat",
                "grupo_muscular": "Piernas",
                "equipo": "Barra"
            },
            {
                "nombre_es": "Dominadas",
                "nombre_en": "Pull-ups",
                "grupo_muscular": "Espalda",
                "equipo": "Barra fija"
            }
        ]
    }
    res = client.post("/api/v1/admin/exercises/import", json=import_payload, headers=superadmin_auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 2
    assert data["insertados"] == 2
