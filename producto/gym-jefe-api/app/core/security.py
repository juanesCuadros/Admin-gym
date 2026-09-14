import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
import jwt
from passlib.context import CryptContext
from app.core.config import settings

# Contexto de hashing con Argon2id
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    """Hashea una contraseña utilizando Argon2id."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica una contraseña plana contra su hash Argon2id."""
    return pwd_context.verify(plain_password, hashed_password)


def hash_token(token: str) -> str:
    """Calcula el hash SHA-256 de un token opaco (refresh token o token de recuperación)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_secure_token(nbytes: int = 32) -> str:
    """Genera una cadena criptográfica aleatoria segura para URLs."""
    return secrets.token_urlsafe(nbytes)


def create_access_token(
    subject: str,
    gym_id: str,
    role: str,
    expires_delta: Optional[timedelta] = None
) -> str:
    """Genera un JWT de acceso con claims estandarizados."""
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    payload: Dict[str, Any] = {
        "sub": str(subject),
        "gym_id": str(gym_id),
        "rol": role,
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> Dict[str, Any]:
    """Decodifica y valida la firma y expiración de un JWT de acceso."""
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise ValueError("Token inválido o expirado") from exc


# --- Cifrado Biométrico Simétrico (RNF-01: AES-256-GCM) ---
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import os


def encrypt_biometric_template(template_bytes: bytes) -> bytes:
    """
    Cifra una plantilla biométrica dactilar utilizando AES-256-GCM.
    Genera un nonce criptográfico de 12 bytes (96 bits) por cada registro.
    Retorna un payload binario autocontenido:
        [12 bytes Nonce] || [Ciphertext + 16 bytes Tag de Autenticación]
    """
    if not template_bytes:
        raise ValueError("La plantilla biométrica no puede estar vacía")
    
    key_bytes = bytes.fromhex(settings.BIOMETRIC_ENCRYPTION_KEY)
    aesgcm = AESGCM(key_bytes)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, template_bytes, None)
    return nonce + ciphertext


def decrypt_biometric_template(encrypted_payload: bytes) -> bytes:
    """
    Descifra un payload biométrico cifrado con AES-256-GCM.
    Extrae los primeros 12 bytes como nonce y el resto como ciphertext + tag de autenticación.
    Lanza ValueError si el payload está truncado, alterado o la autenticación falla.
    """
    # Mínimo 12 bytes de nonce + 16 bytes de tag de autenticación = 28 bytes
    if not encrypted_payload or len(encrypted_payload) < 28:
        raise ValueError("Payload biométrico cifrado inválido o truncado")

    key_bytes = bytes.fromhex(settings.BIOMETRIC_ENCRYPTION_KEY)
    aesgcm = AESGCM(key_bytes)
    nonce = encrypted_payload[:12]
    ciphertext = encrypted_payload[12:]
    
    try:
        return aesgcm.decrypt(nonce, ciphertext, None)
    except Exception as exc:
        raise ValueError("Fallo de autenticación o integridad en la plantilla biométrica") from exc
