from fastapi import APIRouter

from app.modules.auth.router import router as auth_router
from app.modules.control_ingreso.router import router as control_ingreso_router
from app.modules.pantalla_tv.router import router as pantalla_tv_router
from app.modules.caja.router import router as caja_router
from app.modules.deportistas.router import router as deportistas_router
from app.modules.membresias.router import router as membresias_router
from app.modules.entrenamiento.router import router as entrenamiento_router
from app.modules.clases.router import router as clases_router
from app.modules.inventario.router import router as inventario_router
from app.modules.personal.router import router as personal_router
from app.modules.reportes.router import router as reportes_router
from app.modules.my_gym.router import router as my_gym_router

api_v1_router = APIRouter(prefix="/api/v1")

# Inclusión de todos los módulos del Sistema Web (v1)
api_v1_router.include_router(auth_router)
api_v1_router.include_router(control_ingreso_router)
api_v1_router.include_router(pantalla_tv_router)
api_v1_router.include_router(caja_router)
api_v1_router.include_router(deportistas_router)
api_v1_router.include_router(membresias_router)
api_v1_router.include_router(entrenamiento_router)
api_v1_router.include_router(clases_router)
api_v1_router.include_router(inventario_router)
api_v1_router.include_router(personal_router)
api_v1_router.include_router(reportes_router)
api_v1_router.include_router(my_gym_router)
