import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional, Tuple
from sqlalchemy.orm import Session

from app.infrastructure.models.superadmin_models import (
    Gimnasio, CuentaJefe, Suscripcion, EmisionCredenciales,
    ProvisioningPaso, UsuarioInterno
)
from app.infrastructure.models.platform_models import Tenant, Staff
from app.infrastructure.repositories.gym_repository import GymRepository
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.domain.services.subdomain_generator import SubdomainGenerator
from app.domain.services.cutting_date_calculator import CuttingDateCalculator
from app.core.security import generate_secure_temporary_password, get_password_hash
from app.core.exceptions import (
    EntityNotFoundException, EntityConflictException,
    InvalidStateTransitionException, BusinessRuleException
)
from app.core.config import settings
from app.presentation.schemas.gym_schemas import (
    GymCreateStepByStep, GymUpdate, CredentialsIssuanceResponse
)

class GymUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.gym_repo = GymRepository(db)
        self.audit_repo = AuditRepository(db)

    def check_subdomain(self, subdomain: str) -> Tuple[bool, bool, str]:
        """Checks subdomain syntax and database availability (RF-05)."""
        clean = SubdomainGenerator.slugify(subdomain)
        is_valid = SubdomainGenerator.is_valid(clean)
        if not is_valid:
            return False, False, "El subdominio contiene caracteres inválidos o longitud fuera de rango (2-50 caracteres)."

        existing = self.gym_repo.get_by_subdomain(clean)
        if existing:
            return False, True, "El subdominio ya se encuentra registrado por otro gimnasio."

        return True, True, "Subdominio disponible."

    def create_gym(
        self,
        data: GymCreateStepByStep,
        actor: UsuarioInterno
    ) -> Tuple[Gimnasio, CredentialsIssuanceResponse]:
        """
        Creates gym with assisted provisioning (RF-04, RF-06, RF-11, RF-15).
        Idempotently provisions:
        1. Subdomain validation & reservation
        2. Superadmin Gym & Jefe account
        3. Subscription initial plan
        4. Platform Tenant & Staff mirror with temporary password
        5. Provisioning steps tracking
        6. Credentials issuance
        """
        # 1. Resolve & validate subdomain
        raw_subdomain = data.subdominio if data.subdominio else SubdomainGenerator.slugify(data.nombre)
        subdomain = SubdomainGenerator.slugify(raw_subdomain)
        if not SubdomainGenerator.is_valid(subdomain):
            raise BusinessRuleException(f"El subdominio '{subdomain}' no cumple con el formato permitido.")

        if self.gym_repo.get_by_subdomain(subdomain):
            raise EntityConflictException(f"El subdominio '{subdomain}' ya está en uso.")

        # Check Jefe email uniqueness
        existing_jefe = self.db.query(CuentaJefe).filter(CuentaJefe.correo == data.jefe.correo).first()
        if existing_jefe:
            raise EntityConflictException(f"El correo del Jefe '{data.jefe.correo}' ya está registrado.")

        # 2. State & dates resolution
        initial_state = "prueba" if data.suscripcion.tipo_inicio == "prueba" else "activo"
        today = date.today()
        fecha_corte = today + timedelta(days=settings.DEFAULT_TRIAL_DAYS) if initial_state == "prueba" else None

        shared_gimnasio_id = str(uuid.uuid4())

        # 3. Create Superadmin Gym entity
        gym = Gimnasio(
            gimnasio_id=shared_gimnasio_id,
            nombre=data.nombre.strip(),
            subdominio=subdomain,
            nit=data.nit,
            direccion=data.direccion,
            ciudad=data.ciudad,
            telefono=data.telefono,
            correo=data.correo,
            estado=initial_state,
            fecha_inicio=today,
            fecha_corte=fecha_corte,
            logo_url=data.logo_url,
            banner_url=data.banner_url,
            descripcion=data.descripcion,
            instagram=data.instagram,
            facebook=data.facebook,
            whatsapp=data.whatsapp
        )
        self.db.add(gym)
        self.db.flush()

        # 4. Create Jefe account in Superadmin
        cuenta_jefe = CuentaJefe(
            gimnasio_id=gym.id,
            nombre=data.jefe.nombre.strip(),
            correo=data.jefe.correo.lower().strip(),
            telefono=data.jefe.telefono,
            password_cambiada=False
        )
        self.db.add(cuenta_jefe)

        # 5. Create Subscription historical entry (RF-14)
        subscription = Suscripcion(
            gimnasio_id=gym.id,
            valor_mensual=data.suscripcion.valor_mensual,
            tipo_inicio=data.suscripcion.tipo_inicio,
            vigente_desde=today,
            vigente_hasta=None
        )
        self.db.add(subscription)

        # 6. Generate temporary credentials (Argon2id hash)
        temp_password = generate_secure_temporary_password(length=12)
        hashed_temp_password = get_password_hash(temp_password)

        # 7. Provision Platform Tenant and Staff (mirror)
        platform_tenant = Tenant(
            id=shared_gimnasio_id,
            nombre=data.nombre.strip(),
            subdominio=subdomain,
            zona_horaria="America/Bogota",
            dias_gracia_mora=3,
            tope_dias_congelamiento=30,
            metodos_pago='["Efectivo", "Transferencia", "Nequi"]',
            landing_slug=subdomain,
            activo=True
        )
        self.db.add(platform_tenant)
        self.db.flush()  # Ensure platform.tenant row exists before creating dependent staff

        platform_staff = Staff(
            gimnasio_id=shared_gimnasio_id,
            nombre=data.jefe.nombre.strip(),
            correo=data.jefe.correo.lower().strip(),
            hash_password=hashed_temp_password,
            rol="jefe",
            activo=True
        )
        self.db.add(platform_staff)
        self.db.flush()

        # 8. Record Provisioning steps (idempotent tracking)
        pasos = ["crear_tenant", "crear_cuenta_jefe", "configurar_metodos_pago", "activar_catalogo_base"]
        for p in pasos:
            paso_rec = ProvisioningPaso(
                gimnasio_id=gym.id,
                paso=p,
                estado="completado"
            )
            self.db.add(paso_rec)

        # 9. Register credentials issuance (72h expiry)
        expira_en = datetime.now(timezone.utc) + timedelta(hours=settings.CREDENTIALS_EXPIRE_HOURS)
        emision = EmisionCredenciales(
            gimnasio_id=gym.id,
            tipo="emitida",
            expira_en=expira_en,
            veces_reenviada=0,
            enviada_por=actor.id
        )
        self.db.add(emision)

        self.db.commit()
        self.db.refresh(gym)

        # 10. Audit log (password is NEVER logged)
        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="CREACION_GIMNASIO_PROVISIONING",
            entidad="gimnasios",
            entidad_id=gym.id,
            gimnasio_id=gym.id,
            detalle={
                "nombre": gym.nombre,
                "subdominio": gym.subdominio,
                "estado": gym.estado,
                "correo_jefe": cuenta_jefe.correo
            }
        )

        access_url = f"https://{subdomain}.{settings.BASE_DOMAIN}/login"

        whatsapp_text = (
            f"¡Hola {data.jefe.nombre}! Bienvenido a GymOS para {gym.nombre}.\n\n"
            f"Tus credenciales de acceso como Administrador son:\n"
            f"👉 Enlace: {access_url}\n"
            f"👤 Usuario: {cuenta_jefe.correo}\n"
            f"🔑 Contraseña temporal: {temp_password}\n\n"
            f"Por seguridad, esta clave expira en 72 horas. Te recomendamos cambiarla al ingresar."
        )

        credentials_resp = CredentialsIssuanceResponse(
            gimnasio_id=gym.id,
            gimnasio_nombre=gym.nombre,
            correo_jefe=cuenta_jefe.correo,
            url_acceso=access_url,
            password_temporal=temp_password,
            expira_en=expira_en,
            tipo="emitida",
            whatsapp_copiable=whatsapp_text
        )

        return gym, credentials_resp

    def update_gym(self, gym_id: str, data: GymUpdate, actor: UsuarioInterno) -> Gimnasio:
        """Updates gym information; subdomain is strictly immutable (RF-08)."""
        gym = self.gym_repo.get_by_id(gym_id)
        if not gym:
            raise EntityNotFoundException("Gimnasio", gym_id)

        update_fields = data.model_dump(exclude_unset=True)
        for key, value in update_fields.items():
            setattr(gym, key, value)

        self.db.commit()
        self.db.refresh(gym)

        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="ACTUALIZACION_GIMNASIO",
            entidad="gimnasios",
            entidad_id=gym.id,
            gimnasio_id=gym.id,
            detalle=update_fields
        )

        return gym

    def change_state(
        self,
        gym_id: str,
        nuevo_estado: str,
        motivo: Optional[str],
        actor: UsuarioInterno
    ) -> Gimnasio:
        """
        State Machine enforcement (RF-09 / RF-10):
        prueba -> activo
        activo -> suspendido
        suspendido -> activo
        prueba, activo, suspendido -> cancelado
        Propagates tenant and staff access freezing to platform schema.
        """
        gym = self.gym_repo.get_by_id(gym_id)
        if not gym:
            raise EntityNotFoundException("Gimnasio", gym_id)

        current = gym.estado
        if current == nuevo_estado:
            return gym

        # Enforce valid transitions
        allowed_transitions = {
            "prueba": ["activo", "cancelado"],
            "activo": ["suspendido", "cancelado"],
            "suspendido": ["activo", "cancelado"],
            "cancelado": []  # Formal cancellation is permanent freeze (RF-10)
        }

        if nuevo_estado not in allowed_transitions.get(current, []):
            raise InvalidStateTransitionException(current, nuevo_estado)

        if nuevo_estado == "cancelado":
            if not motivo or len(motivo.strip()) < 5:
                raise BusinessRuleException("El motivo de cancelación es obligatorio y debe tener al menos 5 caracteres.")
            gym.motivo_cancelacion = motivo.strip()
            gym.fecha_cancelacion = datetime.now(timezone.utc)

        gym.estado = nuevo_estado

        # Propagate access freezing or reactivation to platform schema (Tenant and Staff)
        platform_tenant = self.db.query(Tenant).filter(Tenant.id == gym.gimnasio_id).first()
        if platform_tenant:
            if nuevo_estado in ["suspendido", "cancelado"]:
                platform_tenant.activo = False
            elif nuevo_estado == "activo":
                platform_tenant.activo = True

        staff_list = self.db.query(Staff).filter(Staff.gimnasio_id == gym.gimnasio_id).all()
        for s in staff_list:
            if nuevo_estado in ["suspendido", "cancelado"]:
                s.activo = False
            elif nuevo_estado == "activo":
                s.activo = True

        self.db.commit()
        self.db.refresh(gym)

        self.audit_repo.record_action(
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="CAMBIO_ESTADO_GIMNASIO",
            entidad="gimnasios",
            entidad_id=gym.id,
            gimnasio_id=gym.id,
            detalle={"estado_anterior": current, "nuevo_estado": nuevo_estado, "motivo": motivo}
        )

        return gym

    def cancel_gym(self, gym_id: str, motivo: str, actor: UsuarioInterno) -> Gimnasio:
        """Formal cancellation (RF-10): freezes access, preserves data."""
        return self.change_state(gym_id, "cancelado", motivo, actor)
