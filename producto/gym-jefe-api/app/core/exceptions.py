from typing import Any, Optional
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class GymOSException(Exception):
    """Excepción base para errores de negocio del sistema GymOS."""
    def __init__(
        self,
        codigo: str,
        mensaje: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        detalles: Optional[Any] = None
    ):
        self.codigo = codigo
        self.mensaje = mensaje
        self.status_code = status_code
        self.detalles = detalles
        super().__init__(mensaje)


class TurnoNoAbiertoException(GymOSException):
    def __init__(self, mensaje: str = "Se requiere un turno de caja abierto para realizar esta operación"):
        super().__init__(
            codigo="TURNO_NO_ABIERTO",
            mensaje=mensaje,
            status_code=status.HTTP_400_BAD_REQUEST
        )


class StockInsuficienteException(GymOSException):
    def __init__(self, producto_nombre: str, stock_actual: int):
        super().__init__(
            codigo="STOCK_INSUFICIENTE",
            mensaje=f"Stock insuficiente para '{producto_nombre}'. Disponible: {stock_actual}",
            status_code=status.HTTP_409_CONFLICT,
            detalles={"producto": producto_nombre, "stock_disponible": stock_actual}
        )


class PermisoDenegadoException(GymOSException):
    def __init__(self, submodulo: str, accion: str):
        super().__init__(
            codigo="PERMISO_DENEGADO",
            mensaje=f"No cuenta con permisos para {accion} en el submódulo {submodulo}",
            status_code=status.HTTP_403_FORBIDDEN,
            detalles={"submodulo": submodulo, "accion": accion}
        )


def register_exception_handlers(app: FastAPI) -> None:
    """Registra los manejadores globales de excepciones en la aplicación FastAPI."""

    @app.exception_handler(GymOSException)
    async def gymos_exception_handler(request: Request, exc: GymOSException):
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": {
                    "codigo": exc.codigo,
                    "mensaje": exc.mensaje,
                    "detalles": exc.detalles
                }
            }
        )

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        # Mapeo de códigos HTTP a códigos semánticos
        code_map = {
            400: "SOLICITUD_INVALIDA",
            401: "NO_AUTORIZADO",
            403: "ACCESO_PROHIBIDO",
            404: "RECURSO_NO_ENCONTRADO",
            409: "CONFLICTO_ESTADO",
            422: "ERROR_VALIDACION",
            429: "LIMITE_PETICIONES_EXCEDIDO",
            500: "ERROR_INTERNO_SERVIDOR"
        }
        codigo = code_map.get(exc.status_code, "ERROR_HTTP")

        # Si el detalle ya es un dict estructurado, lo propagamos
        if isinstance(exc.detail, dict):
            mensaje = exc.detail.get("mensaje", str(exc.detail))
            codigo = exc.detail.get("codigo", codigo)
            detalles = exc.detail.get("detalles", None)
        else:
            mensaje = str(exc.detail)
            detalles = None

        return JSONResponse(
            status_code=exc.status_code,
            content={
                "success": False,
                "error": {
                    "codigo": codigo,
                    "mensaje": mensaje,
                    "detalles": detalles
                }
            }
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError):
        errores = []
        for error in exc.errors():
            campo = " -> ".join(str(loc) for loc in error["loc"])
            errores.append({
                "campo": campo,
                "mensaje": error["msg"],
                "tipo": error["type"]
            })
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "success": False,
                "error": {
                    "codigo": "ERROR_VALIDACION_CAMPOS",
                    "mensaje": "Los datos enviados en la petición no son válidos",
                    "detalles": errores
                }
            }
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={
                "success": False,
                "error": {
                    "codigo": "ERROR_INTERNO_SERVIDOR",
                    "mensaje": "Ocurrió un error interno inesperado en el servidor",
                    "detalles": str(exc) if app.debug else None
                }
            }
        )
