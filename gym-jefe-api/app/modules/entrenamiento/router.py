from fastapi import APIRouter

router = APIRouter(prefix="/entrenamiento", tags=["06. Entrenamiento y Ejercicios"])

@router.get("/status", summary="Estado del módulo entrenamiento")
async def get_status():
    return {"modulo": "entrenamiento", "estado": "scaffolded"}
