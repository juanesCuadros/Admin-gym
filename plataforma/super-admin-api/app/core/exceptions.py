from typing import Any, Dict, Optional

class AppException(Exception):
    """Base application exception."""
    def __init__(self, message: str, status_code: int = 400, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.details = details or {}

class EntityNotFoundException(AppException):
    def __init__(self, entity_name: str, identifier: Any):
        super().__init__(
            message=f"{entity_name} with identifier '{identifier}' was not found.",
            status_code=404,
            details={"entity": entity_name, "identifier": str(identifier)}
        )

class EntityConflictException(AppException):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message=message, status_code=409, details=details)

class AuthenticationFailedException(AppException):
    def __init__(self, message: str = "Credenciales incorrectas o usuario inactivo."):
        super().__init__(message=message, status_code=401)

class AccountLockedException(AppException):
    def __init__(self, lockout_minutes: int):
        super().__init__(
            message=f"Cuenta temporalmente bloqueada por múltiples intentos fallidos. Intente nuevamente en {lockout_minutes} minutos.",
            status_code=423,
            details={"lockout_minutes": lockout_minutes}
        )

class ForbiddenException(AppException):
    def __init__(self, message: str = "No tiene permisos para realizar esta acción."):
        super().__init__(message=message, status_code=403)

class InvalidStateTransitionException(AppException):
    def __init__(self, current_state: str, requested_state: str):
        super().__init__(
            message=f"Transición de estado inválida: no se puede cambiar de '{current_state}' a '{requested_state}'.",
            status_code=422,
            details={"current_state": current_state, "requested_state": requested_state}
        )

class BusinessRuleException(AppException):
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message=message, status_code=422, details=details)

class IdempotencyConflictException(AppException):
    def __init__(self, idempotency_key: str):
        super().__init__(
            message=f"La clave de idempotencia '{idempotency_key}' ya ha sido procesada.",
            status_code=409,
            details={"idempotency_key": idempotency_key}
        )
