from datetime import datetime, timedelta, timezone
from typing import Optional
from sqlalchemy.orm import Session

from app.infrastructure.models.superadmin_models import (
    Gimnasio, CuentaJefe, EmisionCredenciales, UsuarioInterno
)
from app.infrastructure.models.platform_models import Staff
from app.infrastructure.repositories.gym_repository import GymRepository
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.core.security import generate_secure_temporary_password, get_password_hash
from app.core.exceptions import (
    EntityNotFoundException, BusinessRuleException
)
from app.core.config import settings
from app.presentation.schemas.gym_schemas import CredentialsIssuanceResponse

class CredentialsUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.gym_repo = GymRepository(db)
        self.audit_repo = AuditRepository(db)

    def regenerate_credentials(self, gym_id: str, actor: UsuarioInterno) -> CredentialsIssuanceResponse:
        """
        Regenerates credentials, invalidating the previous temporary password (RF-12).
        """
        gym = self.gym_repo.get_by_id(gym_id)
        if not gym:
            raise EntityNotFoundException("Gimnasio", gym_id)

        jefe = gym.cuenta_jefe
        if not jefe:
            raise EntityNotFoundException("CuentaJefe", gym_id)

        # Generate new temporary password
        new_temp_password = generate_secure_temporary_password(length=12)
        hashed_password = get_password_hash(new_temp_password)

        # Update Platform Staff
        staff = self.db.query(Staff).filter(
            Staff.gimnasio_id == gym.gimnasio_id,
            Staff.rol == "jefe"
        ).first()
        if staff:
            staff.hash_password = hashed_password
            staff.activo = True

        # Reset password_cambiada flag in Superadmin
        jefe.password_cambiada = False
        self.db.add(jefe)

        # Record issuance with 72h expiry
        expira_en = datetime.now(timezone.utc) + timedelta(hours=settings.CREDENTIALS_EXPIRE_HOURS)
        emision = EmisionCredenciales(
            gimnasio_id=gym.id,
            tipo="regenerada",
            expira_en=expira_en,
            veces_reenviada=0,
            enviada_por=actor.id
        )
        self.db.add(emision)
        self.db.commit()

        # Audit Log
        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="REGENERACION_CREDENCIALES",
            entidad="emisiones_credenciales",
            entidad_id=emision.id,
            gimnasio_id=gym.id,
            detalle={"correo_jefe": jefe.correo, "tipo": "regenerada"}
        )

        access_url = f"https://{gym.subdominio}.{settings.BASE_DOMAIN}/login"
        whatsapp_text = (
            f"Hola {jefe.nombre}. Se han regenerado tus credenciales de acceso para {gym.nombre}:\n\n"
            f"👉 Enlace: {access_url}\n"
            f"👤 Usuario: {jefe.correo}\n"
            f"🔑 Nueva Contraseña temporal: {new_temp_password}\n\n"
            f"Vigencia: 72 horas."
        )

        return CredentialsIssuanceResponse(
            gimnasio_id=gym.id,
            gimnasio_nombre=gym.nombre,
            correo_jefe=jefe.correo,
            url_acceso=access_url,
            password_temporal=new_temp_password,
            expira_en=expira_en,
            tipo="regenerada",
            whatsapp_copiable=whatsapp_text,
            mensaje="Nuevas credenciales regeneradas con éxito. La contraseña anterior ha sido invalidada."
        )

    def resend_credentials(self, gym_id: str, actor: UsuarioInterno) -> CredentialsIssuanceResponse:
        """
        Reenviar credenciales existentes solo si el Jefe no ha cambiado la contraseña y no ha vencido (RF-13).
        If expired or changed, raises BusinessRuleException recommending regeneration.
        """
        gym = self.gym_repo.get_by_id(gym_id)
        if not gym:
            raise EntityNotFoundException("Gimnasio", gym_id)

        jefe = gym.cuenta_jefe
        if not jefe:
            raise EntityNotFoundException("CuentaJefe", gym_id)

        if jefe.password_cambiada:
            raise BusinessRuleException(
                "El Jefe ya ha cambiado su contraseña personal. Por seguridad, no se puede reenviar; utilice 'Regenerar Credenciales' si olvidó su clave."
            )

        latest_emision = self.db.query(EmisionCredenciales).filter(
            EmisionCredenciales.gimnasio_id == gym.id
        ).order_by(EmisionCredenciales.created_at.desc()).first()

        now = datetime.now(timezone.utc)
        if not latest_emision or latest_emision.expira_en < now:
            raise BusinessRuleException(
                "La contraseña temporal anterior ya ha expirado (más de 72 horas). Debe 'Regenerar Credenciales' para emitir una nueva."
            )

        # Increment count
        latest_emision.veces_reenviada += 1
        self.db.commit()

        # Audit
        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="REENVIO_CREDENCIALES",
            entidad="emisiones_credenciales",
            entidad_id=latest_emision.id,
            gimnasio_id=gym.id,
            detalle={"veces_reenviada": latest_emision.veces_reenviada}
        )

        access_url = f"https://{gym.subdominio}.{settings.BASE_DOMAIN}/login"
        whatsapp_text = (
            f"Recordatorio de credenciales para {jefe.nombre} ({gym.nombre}):\n"
            f"👉 Enlace: {access_url}\n"
            f"👤 Usuario: {jefe.correo}\n"
            f"ℹ️ Usa la contraseña temporal enviada previamente (vigente hasta {latest_emision.expira_en.strftime('%Y-%m-%d %H:%M UTC')})."
        )

        return CredentialsIssuanceResponse(
            gimnasio_id=gym.id,
            gimnasio_nombre=gym.nombre,
            correo_jefe=jefe.correo,
            url_acceso=access_url,
            password_temporal="[CONTRASEÑA TEMPORAL PREVIA VIGENTE]",
            expira_en=latest_emision.expira_en,
            tipo="reenviada",
            whatsapp_copiable=whatsapp_text,
            mensaje="Recordatorio de credenciales registrado y listo para envío."
        )
