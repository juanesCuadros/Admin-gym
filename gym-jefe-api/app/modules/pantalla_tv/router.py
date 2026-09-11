from fastapi import APIRouter

router = APIRouter(prefix="/pantalla-tv", tags=["02. Pantalla TV"])

@router.get("/status", summary="Estado del módulo pantalla_tv")
async def get_status():
    return {"modulo": "pantalla_tv", "estado": "scaffolded"}
