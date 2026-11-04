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
            mensaje="No tienes permiso para hacer esta acción. Pídeselo al Jefe del gimnasio.",
            status_code=status.HTTP_403_FORBIDDEN,
            detalles={"submodulo": submodulo, "accion": accion}
        )


# Mensajes en español para los tipos de error de Pydantic v2 (los de Pydantic salen en inglés).
_MENSAJES_VALIDACION = {
    "missing": "Este dato es obligatorio.",
    "string_type": "Debe ser un texto.",
    "string_too_short": "Debe tener al menos {min_length} caracteres.",
    "string_too_long": "Debe tener máximo {max_length} caracteres.",
    "string_pattern_mismatch": "El formato no es válido.",
    "int_type": "Debe ser un número entero.",
    "int_parsing": "Debe ser un número entero.",
    "int_from_float": "Debe ser un número entero, sin decimales.",
    "float_type": "Debe ser un número.",
    "float_parsing": "Debe ser un número.",
    "decimal_type": "Debe ser un número.",
    "decimal_parsing": "Debe ser un número.",
    "bool_type": "Debe ser sí o no.",
    "bool_parsing": "Debe ser sí o no.",
    "greater_than": "Debe ser mayor que {gt}.",
    "greater_than_equal": "Debe ser mayor o igual a {ge}.",
    "less_than": "Debe ser menor que {lt}.",
    "less_than_equal": "Debe ser menor o igual a {le}.",
    "multiple_of": "Debe ser múltiplo de {multiple_of}.",
    "uuid_type": "El identificador no es válido.",
    "uuid_parsing": "El identificador no es válido.",
    "date_type": "Debe ser una fecha.",
    "date_parsing": "La fecha no es válida.",
    "date_from_datetime_parsing": "La fecha no es válida.",
    "date_from_datetime_inexact": "La fecha no debe incluir hora.",
    "datetime_type": "Debe ser una fecha y hora.",
    "datetime_parsing": "La fecha y hora no es válida.",
    "datetime_from_date_parsing": "La fecha y hora no es válida.",
    "time_type": "Debe ser una hora.",
    "time_parsing": "La hora no es válida.",
    "enum": "Elige una de las opciones: {expected}.",
    "literal_error": "Elige una de las opciones: {expected}.",
    "list_type": "Debe ser una lista.",
    "too_short": "Debe tener al menos {min_length} elemento(s).",
    "too_long": "Debe tener máximo {max_length} elemento(s).",
    "dict_type": "El formato no es válido.",
    "model_type": "El formato no es válido.",
    "model_attributes_type": "El formato no es válido.",
    "json_invalid": "Los datos enviados no tienen un formato válido.",
    "json_type": "Los datos enviados no tienen un formato válido.",
    "extra_forbidden": "Este dato no se permite.",
    "url_parsing": "El enlace no es válido.",
    "url_type": "El enlace no es válido.",
    "url_scheme": "El enlace debe empezar por http:// o https://.",
}


def traducir_error_validacion(error: dict) -> str:
    """Mensaje en español de un error de validación de Pydantic, para mostrarlo junto al campo."""
    tipo = error.get("type", "")
    msg = str(error.get("msg", ""))
    if tipo in ("value_error", "assertion_error"):
        # Los validadores propios ya escriben en español; Pydantic les antepone "Value error, ".
        for prefijo in ("Value error, ", "Assertion failed, "):
            if msg.startswith(prefijo):
                msg = msg[len(prefijo):]
        if "email address" in msg or "@-sign" in msg:
            return "El correo electrónico no es válido."
        return msg
    plantilla = _MENSAJES_VALIDACION.get(tipo)
    if plantilla is None:
        return "El valor no es válido."
    ctx = {k: str(v).replace("'", "").replace(" or ", " o ") for k, v in (error.get("ctx") or {}).items()}
    try:
        return plantilla.format(**ctx)
    except (KeyError, IndexError):
        return "El valor no es válido."


def resumen_errores_validacion(errores: list) -> str:
    """Mensaje general del 422: nombra el primer campo con error para que se entienda sin mirar el formulario."""
    if not errores:
        return "Revisa los datos ingresados."
    nombre = [p.strip() for p in errores[0]["campo"].split("->") if p.strip() not in ("", "body", "query", "path")]
    etiqueta = nombre[-1].replace("_", " ") if nombre else ""
    if etiqueta.isdigit() and len(nombre) > 1:
        etiqueta = nombre[-2].replace("_", " ")
    base = f"Revisa «{etiqueta}»: {errores[0]['mensaje']}" if etiqueta else errores[0]["mensaje"]
    if len(errores) > 1:
        base += f" (y {len(errores) - 1} dato(s) más)"
    return base


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
        for error in exc.errors():
            msg = str(error.get("msg", ""))
            if "ACUDIENTE_REQUERIDO" in msg or "acudiente es obligatorio" in msg.lower():
                return JSONResponse(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    content={
                        "success": False,
                        "error": {
                            "codigo": "ACUDIENTE_REQUERIDO",
                            "mensaje": "Los datos del acudiente son obligatorios para deportistas menores de 18 años.",
                            "detalles": None,
                        },
                    },
                )
            if "AUTORIZACION_ACUDIENTE_REQUERIDA" in msg or "autorización del acudiente" in msg.lower():
                return JSONResponse(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    content={
                        "success": False,
                        "error": {
                            "codigo": "AUTORIZACION_ACUDIENTE_REQUERIDA",
                            "mensaje": "La autorización del acudiente es obligatoria para registrar a un menor de 18 años.",
                            "detalles": None,
                        },
                    },
                )

        errores = []
        for error in exc.errors():
            campo = " -> ".join(str(loc) for loc in error["loc"])
            errores.append({
                "campo": campo,
                "mensaje": traducir_error_validacion(error),
                "tipo": error["type"]
            })
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "success": False,
                "error": {
                    "codigo": "ERROR_VALIDACION_CAMPOS",
                    "mensaje": resumen_errores_validacion(errores),
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
