from fastapi import APIRouter

router = APIRouter(prefix="/personal", tags=["09. Personal y Staff"])

@router.get("/status", summary="Estado del módulo personal")
async def get_status():
    """
    Retorna el estado de disponibilidad del módulo de Personal y Staff.
    """
    return {"modulo": "personal", "estado": "scaffolded"}
