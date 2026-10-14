from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from app.core.exceptions import AppException


def cuerpo_error(codigo: str, mensaje: str, detalles: dict, path: str) -> dict:
    """Cuerpo de error del contrato + claves heredadas que aún lee el panel actual."""
    return {
        "codigo": codigo,
        "mensaje": mensaje,
        "detalles": detalles,
        # Compatibilidad con super-admin-vista (lee `message`); se retiran cuando migre al contrato.
        "error": True,
        "message": mensaje,
        "details": detalles,
        "path": path,
    }


async def app_exception_handler(request: Request, exc: AppException) -> JSONResponse:
    """Errores de dominio y aplicación con el formato uniforme del contrato."""
    return JSONResponse(
        status_code=exc.status_code,
        content=cuerpo_error(exc.codigo, exc.message, exc.details, request.url.path),
    )


async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Fallos de validación de Pydantic con el detalle por campo."""
    errors = []
    for err in exc.errors():
        loc = " -> ".join(str(l) for l in err.get("loc", []))
        errors.append({
            "field": loc,
            "message": err.get("msg"),
            "type": err.get("type")
        })
    return JSONResponse(
        status_code=422,
        content=cuerpo_error(
            "VALIDACION",
            "Error de validación en los datos enviados.",
            {"validation_errors": errors},
            request.url.path,
        ),
    )
