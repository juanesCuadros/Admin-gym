"""
Escritorio · vectores compartidos de la regla de acceso.

La estación decide el ingreso sin red con una copia en Rust de `evaluar_estado_puro`. Este archivo
genera los casos (entrada y resultado esperado) desde la función del servidor; `cargo test` de la
estación exige el mismo resultado, campo por campo. Si la regla cambia aquí y el archivo no se
regenera, esta prueba falla.

Regenerar:  $env:GYMDESK_REGENERAR_VECTORES = "1"; pytest tests/test_e8_vectores_acceso.py
"""
import json
import os
from datetime import date, timedelta
from pathlib import Path

from app.modules.membresias.domain import MembresiaDomainService

ARCHIVO = Path(__file__).resolve().parents[2] / "gym-desk-escritorio" / "src-tauri" / "src" / "acceso" / "casos_acceso.json"

# (hoy, [(días de gracia, umbral de por vencer)]). Incluye cambio de año y un 29 de febrero.
_ESCENARIOS = [
    (date(2026, 11, 13), [(3, 5), (0, 5), (5, 7), (3, 0), (0, 0)]),
    (date(2027, 1, 1), [(3, 5)]),
    (date(2028, 2, 29), [(3, 5)]),
]
# Días entre hoy y el vencimiento: cada borde de gracia y de "por vencer", y valores lejanos.
_VENCE_EN = [-40, -6, -5, -4, -3, -2, -1, 0, 1, 4, 5, 6, 7, 8, 30]


def generar() -> list:
    casos = []
    for hoy, parametros in _ESCENARIOS:
        for gracia, umbral in parametros:
            for activo in (True, False):
                entradas = [
                    {"tiene_membresia": False, "ultima_cancelada": False, "fecha_vencimiento": None, "congelamiento_activo": False},
                    {"tiene_membresia": False, "ultima_cancelada": True, "fecha_vencimiento": None, "congelamiento_activo": False},
                ]
                for dias in _VENCE_EN:
                    for congelado in (False, True):
                        entradas.append({
                            "tiene_membresia": True, "ultima_cancelada": False,
                            "fecha_vencimiento": hoy + timedelta(days=dias), "congelamiento_activo": congelado,
                        })
                for e in entradas:
                    r = MembresiaDomainService.evaluar_estado_puro(
                        hoy=hoy, activo_deportista=activo, dias_gracia_mora=gracia, dias_umbral_por_vencer=umbral, **e
                    )
                    casos.append({
                        "hoy": hoy.isoformat(), "activo": activo, "dias_gracia_mora": gracia, "dias_umbral_por_vencer": umbral,
                        "tiene_membresia": e["tiene_membresia"], "ultima_cancelada": e["ultima_cancelada"],
                        "fecha_vencimiento": e["fecha_vencimiento"].isoformat() if e["fecha_vencimiento"] else None,
                        "congelamiento_activo": e["congelamiento_activo"],
                        "esperado": {
                            "estado": r.estado, "dias_restantes_o_vencido": r.dias_restantes_o_vencido,
                            "permite_ingreso": r.permite_ingreso, "resultado_acceso": r.resultado_acceso, "mensaje": r.mensaje,
                        },
                    })
    return casos


def _texto(casos: list) -> str:
    # Un caso por línea: los cambios de la regla se leen bien en el diff.
    return "[\n" + ",\n".join(json.dumps(c, ensure_ascii=False, sort_keys=True) for c in casos) + "\n]\n"


def test_los_vectores_cubren_todos_los_estados_y_resultados():
    esperados = [c["esperado"] for c in generar()]
    assert {e["estado"] for e in esperados} == {
        "desactivado", "cancelado", "sin_membresia", "congelado", "vencido", "en_gracia", "por_vencer", "activo",
    }
    assert {e["resultado_acceso"] for e in esperados} == {"abrio", "alerta_mora", "negado"}


def test_el_archivo_que_usa_la_estacion_esta_al_dia_con_la_regla_del_servidor():
    texto = _texto(generar())
    if os.environ.get("GYMDESK_REGENERAR_VECTORES") == "1":
        ARCHIVO.parent.mkdir(parents=True, exist_ok=True)
        ARCHIVO.write_text(texto, encoding="utf-8", newline="\n")
    assert ARCHIVO.exists(), f"Falta {ARCHIVO}. Regenera con GYMDESK_REGENERAR_VECTORES=1."
    assert ARCHIVO.read_text(encoding="utf-8") == texto, (
        "La regla de acceso del servidor cambió y la estación sigue con los vectores viejos. "
        "Regenera con GYMDESK_REGENERAR_VECTORES=1 y ajusta acceso/regla.rs hasta que `cargo test` pase."
    )
