from fastapi import APIRouter

router = APIRouter(prefix="/clases", tags=["07. Clases y Reservas"])

@router.get("/status", summary="Estado del módulo clases")
async def get_status():
    return {"modulo": "clases", "estado": "scaffolded"}
