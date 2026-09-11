from fastapi import APIRouter

router = APIRouter(prefix="/caja", tags=["03. Caja y Turnos"])

@router.get("/status", summary="Estado del módulo caja")
async def get_status():
    return {"modulo": "caja", "estado": "scaffolded"}
