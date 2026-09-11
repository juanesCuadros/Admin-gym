from fastapi import APIRouter

router = APIRouter(prefix="/deportistas", tags=["04. Deportistas"])

@router.get("/status", summary="Estado del módulo deportistas")
async def get_status():
    return {"modulo": "deportistas", "estado": "scaffolded"}
