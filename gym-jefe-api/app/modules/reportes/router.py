from fastapi import APIRouter

router = APIRouter(prefix="/reportes", tags=["10. Reportes y Métricas"])

@router.get("/status", summary="Estado del módulo reportes")
async def get_status():
    return {"modulo": "reportes", "estado": "scaffolded"}
