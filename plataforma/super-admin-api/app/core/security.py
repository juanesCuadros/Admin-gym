from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Union
import secrets
import string
import hashlib
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
import jwt

from app.core.config import settings

# Argon2id password hasher (RFC 9106 recommended parameters)
ph = PasswordHasher(
    time_cost=3,
    memory_cost=65536,  # 64 MB
    parallelism=4,
    hash_len=32,
    salt_len=16
)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain password against an Argon2id hash."""
    try:
        return ph.verify(hashed_password, plain_password)
    except (VerifyMismatchError, VerificationError):
        return False

def get_password_hash(password: str) -> str:
    """Generates an Argon2id hash for the given password."""
    return ph.hash(password)

def create_access_token(
    subject: Union[str, Any],
    email: str,
    role: str = "admin",
    expires_delta: Optional[timedelta] = None
) -> str:
    """Creates a signed JWT access token for Super-Admin users."""
    now = datetime.now(timezone.utc)
    if expires_delta:
        expire = now + expires_delta
    else:
        expire = now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode: Dict[str, Any] = {
        "sub": str(subject),
        "email": email,
        "role": role,
        "exp": int(expire.timestamp()),
        "iat": int(now.timestamp()),
        "type": "access_token"
    }
    encoded_jwt = jwt.encode(to_encode, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> Dict[str, Any]:
    """Decodes and validates a JWT token, raising appropriate jwt errors."""
    return jwt.decode(
        token,
        settings.JWT_SECRET_KEY,
        algorithms=[settings.JWT_ALGORITHM]
    )

def generate_cryptographic_token(length: int = 32) -> str:
    """
    Generates a cryptographically strong, URL-safe random token.
    Used for password recovery and sensitive temporary verification tokens (CWE-330 protection).
    """
    return secrets.token_urlsafe(length)

def generate_secure_temporary_password(length: int = 12) -> str:
    """
    Generates a cryptographically strong, human-readable temporary password.
    Contains uppercase, lowercase, numbers, and allowed punctuation.
    """
    chars = string.ascii_letters + string.digits + "!@#$%&*"
    while True:
        password = ''.join(secrets.choice(chars) for _ in range(length))
        # Ensure at least 1 upper, 1 lower, 1 digit, 1 special
        if (any(c.islower() for c in password)
                and any(c.isupper() for c in password)
                and any(c.isdigit() for c in password)
                and any(c in "!@#$%&*" for c in password)):
            return password

def compute_sha256_hash(data: str) -> str:
    """Computes SHA-256 hexadecimal hash string for tokens and audit records."""
    return hashlib.sha256(data.encode('utf-8')).hexdigest()

def compute_audit_hash(
    hash_previo: Optional[str],
    actor_id: Optional[str],
    accion: str,
    entidad: str,
    entidad_id: Optional[str],
    detalle_str: str,
    created_at_iso: str
) -> str:
    """
    Computes cryptographic hash chain entry:
    SHA256(hash_previo + actor_id + accion + entidad + entidad_id + detalle + timestamp)
    """
    payload = f"{hash_previo or ''}|{actor_id or ''}|{accion}|{entidad}|{entidad_id or ''}|{detalle_str}|{created_at_iso}"
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()
