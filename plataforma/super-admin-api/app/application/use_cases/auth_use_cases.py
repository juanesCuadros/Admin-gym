from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from sqlalchemy.orm import Session
from app.infrastructure.repositories.admin_user_repository import AdminUserRepository
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.infrastructure.models.superadmin_models import UsuarioInterno, TokenRecuperacion, TokenInvalido
from app.core.security import (
    verify_password, get_password_hash, create_access_token,
    compute_sha256_hash, generate_cryptographic_token, decode_access_token
)
from app.core.exceptions import (
    AuthenticationFailedException, AccountLockedException,
    EntityNotFoundException, BusinessRuleException
)
from app.core.config import settings

class AuthUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.user_repo = AdminUserRepository(db)
        self.audit_repo = AuditRepository(db)

    def login(self, correo: str, password: str, client_ip: Optional[str] = None) -> Tuple[str, UsuarioInterno]:
        # 1. Check for account lockout (RF-00.4)
        if self.user_repo.is_locked_out(correo):
            raise AccountLockedException(lockout_minutes=settings.LOGIN_LOCKOUT_MINUTES)

        user = self.user_repo.get_by_email(correo)
        if not user or not user.activo:
            self.user_repo.record_login_attempt(correo, client_ip, success=False)
            raise AuthenticationFailedException()

        # 2. Verify Argon2id password hash
        if not verify_password(password, user.hash_password):
            self.user_repo.record_login_attempt(correo, client_ip, success=False)
            raise AuthenticationFailedException()

        # 3. Successful login
        self.user_repo.record_login_attempt(correo, client_ip, success=True)
        self.user_repo.update_last_login(user)

        # 4. Generate JWT
        token = create_access_token(
            subject=user.id,
            email=user.correo,
            role=user.rol
        )

        # 5. Record in immutable audit trail
        self.audit_repo.record_action(
            actor_id=user.id,
            actor_nombre=user.nombre,
            accion="LOGIN_EXITOSO",
            entidad="usuarios_internos",
            entidad_id=user.id,
            detalle={"ip": client_ip}
        )

        return token, user

    def request_password_recovery(self, correo: str) -> Optional[str]:
        """Generates cryptographically secure recovery token link (RF-00.2, CWE-330 mitigated)."""
        user = self.user_repo.get_by_email(correo)
        if not user or not user.activo:
            return None  # Security best practice: do not reveal email existence

        # Cryptographically secure random token (URL safe)
        raw_token = generate_cryptographic_token(32)
        token_hash = compute_sha256_hash(raw_token)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=2)

        recovery = TokenRecuperacion(
            usuario_id=user.id,
            token_hash=token_hash,
            expira_en=expires_at
        )
        self.db.add(recovery)
        self.db.commit()

        self.audit_repo.record_action(
            actor_id=user.id,
            actor_nombre=user.nombre,
            accion="SOLICITUD_RECUPERACION_PASSWORD",
            entidad="usuarios_internos",
            entidad_id=user.id
        )

        return raw_token

    def reset_password(self, raw_token: str, nueva_password: str) -> bool:
        token_hash = compute_sha256_hash(raw_token)
        rec = self.db.query(TokenRecuperacion).filter(
            TokenRecuperacion.token_hash == token_hash,
            TokenRecuperacion.usado_en.is_(None)
        ).first()

        now = datetime.now(timezone.utc)
        if not rec:
            raise BusinessRuleException("El enlace de recuperación es inválido o ha expirado.")

        exp_dt = rec.expira_en
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)

        if exp_dt < now:
            raise BusinessRuleException("El enlace de recuperación es inválido o ha expirado.")


        user = self.user_repo.get_by_id(rec.usuario_id)
        if not user:
            raise EntityNotFoundException("Usuario", rec.usuario_id)

        user.hash_password = get_password_hash(nueva_password)
        rec.usado_en = datetime.now(timezone.utc)
        self.db.commit()

        self.audit_repo.record_action(
            actor_id=user.id,
            actor_nombre=user.nombre,
            accion="CAMBIO_PASSWORD_RECUPERACION",
            entidad="usuarios_internos",
            entidad_id=user.id
        )

        return True

    def logout(self, token: str, user: UsuarioInterno) -> bool:
        """
        Revokes the active JWT access token and records logout in immutable audit log (RF-00.3).
        """
        token_hash = compute_sha256_hash(token)
        existing = self.db.query(TokenInvalido).filter(TokenInvalido.token_hash == token_hash).first()
        if not existing:
            try:
                payload = decode_access_token(token)
                exp_ts = payload.get("exp")
                expira_en = datetime.fromtimestamp(exp_ts, tz=timezone.utc) if exp_ts else datetime.now(timezone.utc) + timedelta(hours=1)
            except Exception:
                expira_en = datetime.now(timezone.utc) + timedelta(hours=1)

            revoked_token = TokenInvalido(
                token_hash=token_hash,
                usuario_id=user.id,
                expira_en=expira_en,
                revocado_en=datetime.now(timezone.utc)
            )
            self.db.add(revoked_token)
            self.db.commit()

        self.audit_repo.record_action(
            actor_id=user.id,
            actor_nombre=user.nombre,
            accion="LOGOUT",
            entidad="usuarios_internos",
            entidad_id=user.id
        )
        return True

