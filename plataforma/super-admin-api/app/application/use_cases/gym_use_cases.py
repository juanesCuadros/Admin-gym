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
from app.core.fechas import hoy_bogota
from app.presentation.schemas.gym_schemas import (
    GymCreateStepByStep, GymUpdate, CredentialsIssuanceResponse
)
from app.presentation.schemas.payment_schemas import PaymentCreate
from app.application.use_cases.payment_use_cases import PaymentUseCases
from app.application.use_cases.plan_use_cases import PlanUseCases

# Transiciones de estado guardado permitidas (§2.1). Cualquier otra responde 422.
TRANSICIONES = {
    "prueba": ("activo", "suspendido", "cancelado"),
    "activo": ("suspendido", "cancelado"),
    "suspendido": ("activo", "cancelado"),
    "cancelado": (),
}


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

        # 2. Plan (SA-RF-33): obligatorio, activo y coherente con el tipo de inicio.
        plan = PlanUseCases(self.db).obtener_disponible(data.suscripcion.plan_id)
        if (data.suscripcion.tipo_inicio == "prueba") != (plan.tipo == "prueba"):
            raise BusinessRuleException(
                "El tipo de inicio no coincide con el plan: una prueba usa el plan de prueba y un "
                "cliente activo un plan de pago.",
                codigo="PLAN_INCOHERENTE",
            )

        # 3. Provisioning (SA-RF-06) con contraseña temporal de 72 h (SA-RF-11).
        temp_password = generate_secure_temporary_password(length=12)
        try:
            gym, cuenta_jefe, expira_en = self.provisionar(
                nombre=data.nombre, subdominio=subdomain, plan=plan,
                tipo_inicio=data.suscripcion.tipo_inicio, valor_mensual=data.suscripcion.valor_mensual,
                jefe_nombre=data.jefe.nombre, jefe_correo=data.jefe.correo, jefe_telefono=data.jefe.telefono,
                hash_password=get_password_hash(temp_password), password_temporal=True,
                actor_id=actor.id, actor_nombre=actor.nombre,
                datos={
                    "nit": data.nit, "direccion": data.direccion, "ciudad": data.ciudad,
                    "telefono": data.telefono, "correo": data.correo, "logo_url": data.logo_url,
                    "banner_url": data.banner_url, "descripcion": data.descripcion,
                    "instagram": data.instagram, "facebook": data.facebook, "whatsapp": data.whatsapp,
                },
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        self.db.refresh(gym)

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

    # Métodos de pago por defecto del gimnasio nuevo (SA-RF-06 CA1).
    METODOS_PAGO_INICIALES = '["Efectivo", "Tarjeta", "Transferencia"]'
    PASOS_PROVISIONING = ("crear_tenant", "crear_cuenta_jefe", "configurar_metodos_pago", "activar_catalogo_base")

    def provisionar(
        self,
        *,
        nombre: str,
        subdominio: str,
        plan,
        tipo_inicio: str,
        valor_mensual,
        jefe_nombre: str,
        jefe_correo: str,
        jefe_telefono: Optional[str],
        hash_password: str,
        password_temporal: bool,
        actor_id: Optional[str],
        actor_nombre: str,
        datos: Optional[dict] = None,
        accion_auditoria: str = "CREACION_GIMNASIO_PROVISIONING",
    ):
        """Provisioning en UNA transacción (SA-RF-06 CA1), sin commit: gimnasio, cuenta del Jefe,
        suscripción con plan, tenant con métodos de pago y parámetros iniciales, Jefe en staff,
        pasos de provisioning y auditoría. Lo usan el alta asistida y el registro autónomo."""
        datos = datos or {}
        initial_state = "prueba" if tipo_inicio == "prueba" else "activo"
        today = hoy_bogota()
        dias_prueba = plan.dias_prueba or settings.DEFAULT_TRIAL_DAYS
        fecha_corte = today + timedelta(days=dias_prueba) if initial_state == "prueba" else None
        shared_gimnasio_id = str(uuid.uuid4())
        correo = jefe_correo.lower().strip()

        gym = Gimnasio(
            gimnasio_id=shared_gimnasio_id, nombre=nombre.strip(), subdominio=subdominio,
            estado=initial_state, fecha_inicio=today, fecha_corte=fecha_corte, **datos
        )
        self.db.add(gym)
        self.db.flush()

        cuenta_jefe = CuentaJefe(
            gimnasio_id=gym.id, nombre=jefe_nombre.strip(), correo=correo, telefono=jefe_telefono,
            password_cambiada=not password_temporal
        )
        self.db.add(cuenta_jefe)
        self.db.add(Suscripcion(
            gimnasio_id=gym.id, valor_mensual=valor_mensual, tipo_inicio=tipo_inicio,
            vigente_desde=today, vigente_hasta=None, plan_id=plan.id
        ))

        self.db.add(Tenant(
            id=shared_gimnasio_id, nombre=nombre.strip(), subdominio=subdominio, zona_horaria="America/Bogota",
            dias_gracia_mora=3, tope_dias_congelamiento=30, metodos_pago=self.METODOS_PAGO_INICIALES,
            landing_slug=subdominio, activo=True
        ))
        self.db.flush()  # el tenant debe existir antes del staff
        self.db.add(Staff(
            gimnasio_id=shared_gimnasio_id, nombre=jefe_nombre.strip(), correo=correo,
            hash_password=hash_password, rol="jefe", activo=True
        ))
        self.db.flush()

        for p in self.PASOS_PROVISIONING:
            self.db.add(ProvisioningPaso(gimnasio_id=gym.id, paso=p, estado="completado"))

        expira_en = None
        if password_temporal:
            expira_en = datetime.now(timezone.utc) + timedelta(hours=settings.CREDENTIALS_EXPIRE_HOURS)
            self.db.add(EmisionCredenciales(
                gimnasio_id=gym.id, tipo="emitida", expira_en=expira_en, veces_reenviada=0, enviada_por=actor_id
            ))
        self.db.flush()

        # La contraseña NUNCA va a la auditoría.
        self.audit_repo.record_action(
            actor_id=actor_id, actor_nombre=actor_nombre, accion=accion_auditoria,
            entidad="gimnasios", entidad_id=gym.id, gimnasio_id=gym.id,
            detalle={"nombre": gym.nombre, "subdominio": gym.subdominio, "estado": gym.estado,
                     "correo_jefe": correo, "plan": plan.codigo},
            commit=False,
        )
        return gym, cuenta_jefe, expira_en

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
        actor: UsuarioInterno,
        pago: Optional[PaymentCreate] = None,
        commit: bool = True,
    ) -> Gimnasio:
        """
        Máquina de estados (§2.1, SA-RF-09, SA-RF-10):
          prueba → activo        pago en la misma operación (ancla = fecha del pago)
          suspendido → activo    pago en la misma operación (ancla = fecha del pago)
          prueba/activo → suspendido   con motivo
          cualquiera → cancelado       con motivo
        Si el pago falla, el estado no cambia (CA3): todo va en una transacción.
        El bloqueo del Sistema Web se apoya en el estado (platform.estado_suscripcion) y en
        tenant.activo; el staff NO se toca, para no pisar las desactivaciones que hizo el Jefe.
        """
        gym = self.gym_repo.get_by_id(gym_id)
        if not gym:
            raise EntityNotFoundException("Gimnasio", gym_id)

        current = gym.estado
        if nuevo_estado not in TRANSICIONES.get(current, ()):
            raise InvalidStateTransitionException(current, nuevo_estado)

        if nuevo_estado in ("suspendido", "cancelado"):
            if not motivo or len(motivo.strip()) < 5:
                raise BusinessRuleException(
                    "El motivo es obligatorio para suspender o cancelar y debe tener al menos 5 caracteres.",
                    codigo="MOTIVO_REQUERIDO",
                )

        pagos = PaymentUseCases(self.db)
        if nuevo_estado == "activo":
            if pago is None:
                raise BusinessRuleException(
                    "Para activar o reactivar el gimnasio hay que registrar el pago en la misma operación.",
                    codigo="PAGO_REQUERIDO",
                )
            pagos.validar_pago(pago.fecha_pago, pago.idempotency_key)

        try:
            pago_registrado = None
            nueva_corte = gym.fecha_corte
            if nuevo_estado == "activo":
                # El pago se registra con el estado anterior (prueba o suspendido): fija el ancla.
                pago_registrado, nueva_corte = pagos.agregar_pago(
                    gym, pago.monto, pago.meses, pago.fecha_pago, pago.metodo, pago.nota,
                    pago.idempotency_key, actor
                )

            if nuevo_estado == "cancelado":
                gym.motivo_cancelacion = motivo.strip()
                gym.fecha_cancelacion = datetime.now(timezone.utc)

            gym.estado = nuevo_estado

            platform_tenant = self.db.query(Tenant).filter(Tenant.id == gym.gimnasio_id).first()
            if platform_tenant:
                platform_tenant.activo = nuevo_estado == "activo"

            if pago_registrado is not None:
                self.audit_repo.record_action(
                    actor_id=actor.id,
                    actor_nombre=actor.nombre,
                    accion="REGISTRO_PAGO",
                    entidad="pagos",
                    entidad_id=pago_registrado.id,
                    gimnasio_id=gym.id,
                    detalle={
                        "monto": int(pago_registrado.monto),
                        "meses": pago_registrado.meses,
                        "metodo": pago_registrado.metodo,
                        "fecha_pago": str(pago_registrado.fecha_pago),
                        "fija_ancla": pago_registrado.fija_ancla,
                        "nueva_fecha_corte": str(nueva_corte),
                        "origen": "reactivacion" if current == "suspendido" else "activacion",
                    },
                    commit=False,
                )
            self.audit_repo.record_action(
                actor_id=actor.id,
                actor_nombre=actor.nombre,
                accion="CAMBIO_ESTADO_GIMNASIO",
                entidad="gimnasios",
                entidad_id=gym.id,
                gimnasio_id=gym.id,
                detalle={
                    "estado_anterior": current,
                    "nuevo_estado": nuevo_estado,
                    "motivo": motivo,
                    "pago_id": pago_registrado.id if pago_registrado else None,
                },
                commit=False,
            )
            if commit:
                self.db.commit()
        except Exception:
            self.db.rollback()
            raise

        if commit:
            self.db.refresh(gym)
        return gym

    def cancel_gym(self, gym_id: str, motivo: str, actor: UsuarioInterno) -> Gimnasio:
        """Formal cancellation (RF-10): freezes access, preserves data."""
        return self.change_state(gym_id, "cancelado", motivo, actor)
