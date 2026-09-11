from fastapi import APIRouter

router = APIRouter(prefix="/inventario", tags=["08. Inventario y Stock"])

@router.get("/status", summary="Estado del módulo inventario")
async def get_status():
    return {"modulo": "inventario", "estado": "scaffolded"}
