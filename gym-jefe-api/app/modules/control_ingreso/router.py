from fastapi import APIRouter

router = APIRouter(prefix="/control-ingreso", tags=["01. Control de Ingreso"])

@router.get("/status", summary="Estado del módulo control_ingreso")
async def get_status():
    return {"modulo": "control_ingreso", "estado": "scaffolded"}
