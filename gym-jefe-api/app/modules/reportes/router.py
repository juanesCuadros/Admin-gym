from fastapi import APIRouter

router = APIRouter(prefix="/reportes", tags=["10. Reportes y Métricas"])

@router.get("/status", summary="Estado del módulo reportes")
async def get_status():
    """
    Retorna el estado de disponibilidad del módulo de Reportes y Métricas.
    """
    return {"modulo": "reportes", "estado": "scaffolded"}
