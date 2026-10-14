from typing import Any, Dict, Optional

# Formato de error del contrato (docs/CONTRATOS-API.md):
#   {"codigo": "MAYUSCULAS", "mensaje": "...", "detalles": {...}}
# El manejador también emite las claves heredadas (error/message/details) para no romper el
# panel actual (super-admin-vista), que todavía lee `message`.


class AppException(Exception):
    """Excepción base de la aplicación."""
    codigo_por_defecto = "ERROR"

    def __init__(
        self,
        message: str,
        status_code: int = 400,
        details: Optional[Dict[str, Any]] = None,
        codigo: Optional[str] = None,
    ):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details or {}
        self.codigo = codigo or self.codigo_por_defecto


class EntityNotFoundException(AppException):
    codigo_por_defecto = "NO_ENCONTRADO"

    def __init__(self, entity_name: str, identifier: Any, codigo: Optional[str] = None):
        super().__init__(
            message=f"{entity_name} con identificador '{identifier}' no existe.",
            status_code=404,
            details={"entity": entity_name, "identifier": str(identifier)},
            codigo=codigo,
        )


class EntityConflictException(AppException):
    codigo_por_defecto = "CONFLICTO"

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None, codigo: Optional[str] = None):
        super().__init__(message=message, status_code=409, details=details, codigo=codigo)


class AuthenticationFailedException(AppException):
    codigo_por_defecto = "CREDENCIALES_INVALIDAS"

    def __init__(self, message: str = "Credenciales incorrectas o usuario inactivo."):
        super().__init__(message=message, status_code=401)


class ForbiddenException(AppException):
    codigo_por_defecto = "SIN_PERMISO"

    def __init__(self, message: str = "No tiene permisos para realizar esta acción."):
        super().__init__(message=message, status_code=403)


class InvalidStateTransitionException(AppException):
    codigo_por_defecto = "TRANSICION_INVALIDA"

    def __init__(self, current_state: str, requested_state: str):
        super().__init__(
            message=f"Transición de estado inválida: no se puede cambiar de '{current_state}' a '{requested_state}'.",
            status_code=422,
            details={"current_state": current_state, "requested_state": requested_state},
        )


class BusinessRuleException(AppException):
    codigo_por_defecto = "REGLA_DE_NEGOCIO"

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None, codigo: Optional[str] = None):
        super().__init__(message=message, status_code=422, details=details, codigo=codigo)


class GoneException(AppException):
    codigo_por_defecto = "RECURSO_VENCIDO"

    def __init__(self, message: str, codigo: Optional[str] = None):
        super().__init__(message=message, status_code=410, codigo=codigo)


class IdempotencyConflictException(AppException):
    codigo_por_defecto = "IDEMPOTENCY_KEY_DUPLICADA"

    def __init__(self, idempotency_key: str):
        super().__init__(
            message=f"La clave de idempotencia '{idempotency_key}' ya ha sido procesada.",
            status_code=409,
            details={"idempotency_key": idempotency_key},
        )
