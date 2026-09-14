from fastapi import APIRouter
from app.presentation.api.v1.endpoints import (
    auth, dashboard, gyms, credentials, payments, exercises, audit
)

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(dashboard.router)
api_router.include_router(gyms.router)
api_router.include_router(credentials.router)
api_router.include_router(payments.router)
api_router.include_router(exercises.router)
api_router.include_router(audit.router)
