from fastapi import APIRouter

router = APIRouter(prefix="/my-gym", tags=["11. Configuración MyGymOS"])

@router.get("/status", summary="Estado del módulo my_gym")
async def get_status():
    """
    Retorna el estado de disponibilidad del módulo de Configuración MyGymOS.
    """
    return {"modulo": "my_gym", "estado": "scaffolded"}
