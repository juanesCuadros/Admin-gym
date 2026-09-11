from fastapi import APIRouter

router = APIRouter(prefix="/membresias", tags=["05. Membresías y Planes"])

@router.get("/status", summary="Estado del módulo membresias")
async def get_status():
    return {"modulo": "membresias", "estado": "scaffolded"}
