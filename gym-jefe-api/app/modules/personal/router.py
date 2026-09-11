from fastapi import APIRouter

router = APIRouter(prefix="/personal", tags=["09. Personal y Staff"])

@router.get("/status", summary="Estado del módulo personal")
async def get_status():
    return {"modulo": "personal", "estado": "scaffolded"}
