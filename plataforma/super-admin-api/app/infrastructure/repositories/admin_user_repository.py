from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.infrastructure.models.superadmin_models import UsuarioInterno, IntentoLogin
from app.core.config import settings

class AdminUserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_email(self, email: str) -> Optional[UsuarioInterno]:
        return self.db.query(UsuarioInterno).filter(
            func.lower(UsuarioInterno.correo) == email.strip().lower(),
            UsuarioInterno.deleted_at.is_(None)
        ).first()

    def get_by_id(self, user_id: str) -> Optional[UsuarioInterno]:
        return self.db.query(UsuarioInterno).filter(
            UsuarioInterno.id == user_id,
            UsuarioInterno.deleted_at.is_(None)
        ).first()

    def record_login_attempt(self, email: str, ip: Optional[str], success: bool) -> None:
        clean_ip = None
        if ip:
            try:
                import ipaddress
                ipaddress.ip_address(ip)
                clean_ip = ip
            except ValueError:
                clean_ip = None

        attempt = IntentoLogin(
            correo=email.strip().lower(),
            ip=clean_ip,
            exito=success,
            created_at=datetime.now(timezone.utc)
        )
        self.db.add(attempt)
        self.db.commit()

    def is_locked_out(self, email: str) -> bool:
        """Checks if email exceeded MAX_LOGIN_ATTEMPTS in the last LOGIN_LOCKOUT_MINUTES since the last successful login (RF-00.4)."""
        window_start = datetime.now(timezone.utc) - timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
        
        # Check if there was a successful login within the window
        latest_success = self.db.query(IntentoLogin.created_at).filter(
            func.lower(IntentoLogin.correo) == email.strip().lower(),
            IntentoLogin.exito.is_(True)
        ).order_by(IntentoLogin.created_at.desc()).first()

        effective_start = window_start
        if latest_success and latest_success[0] and latest_success[0] > window_start:
            effective_start = latest_success[0]

        failed_count = self.db.query(IntentoLogin).filter(
            func.lower(IntentoLogin.correo) == email.strip().lower(),
            IntentoLogin.exito.is_(False),
            IntentoLogin.created_at >= effective_start
        ).count()
        return failed_count >= settings.MAX_LOGIN_ATTEMPTS

    def update_last_login(self, user: UsuarioInterno) -> None:
        user.ultimo_ingreso = datetime.now(timezone.utc)
        self.db.commit()

    def save(self, user: UsuarioInterno) -> UsuarioInterno:
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)
        return user
