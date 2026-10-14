"""Registro autónomo con prueba gratis (SA-RF-34, contrato 3.2)."""
import re
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple

from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.application.use_cases.gym_use_cases import GymUseCases
from app.core.config import settings
from app.core.correo import AdaptadorCorreo, obtener_correo
from app.core.exceptions import (
    BusinessRuleException, EntityConflictException, EntityNotFoundException, GoneException
)
from app.core.security import compute_sha256_hash, generate_cryptographic_token, get_password_hash
from app.domain.services.subdomain_generator import SubdomainGenerator
from app.infrastructure.models.superadmin_models import CuentaJefe, PlanSuscripcion, RegistroAutonomo
from app.infrastructure.repositories.gym_repository import GymRepository
from app.presentation.schemas.public_schemas import SignupRequest

ACTOR_REGISTRO = "Registro autónomo"
MENSAJE_SIGNUP = (
    "Si los datos son válidos, enviamos un enlace de confirmación a tu correo. "
    "Tienes 24 horas para confirmarlo."
)


def normalizar_telefono(telefono: str) -> str:
    """Solo dígitos; quita el indicativo 57 de Colombia si viene con un número de 10 dígitos."""
    digitos = re.sub(r"\D", "", telefono or "")
    if len(digitos) == 12 and digitos.startswith("57"):
        digitos = digitos[2:]
    return digitos


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class SignupUseCases:
    def __init__(self, db: Session, correo: Optional[AdaptadorCorreo] = None):
        self.db = db
        self.gym_repo = GymRepository(db)
        self.correo = correo or obtener_correo()

    # ------------------------------------------------------------------
    def subdominio_disponible(self, subdominio: str) -> bool:
        return SubdomainGenerator.is_valid(subdominio) and self.gym_repo.get_by_subdomain(subdominio) is None

    def sugerir_subdominio(self, nombre: str) -> Tuple[str, bool]:
        base = SubdomainGenerator.slugify(nombre)
        return base, self.subdominio_disponible(base)

    def _primer_subdominio_libre(self, nombre: str) -> str:
        base = SubdomainGenerator.slugify(nombre)
        if self.subdominio_disponible(base):
            return base
        for n in range(2, 1000):
            sufijo = f"-{n}"
            candidato = base[: 63 - len(sufijo)].rstrip("-") + sufijo
            if self.subdominio_disponible(candidato):
                return candidato
        raise EntityConflictException("No hay un subdominio disponible para ese nombre.", codigo="SUBDOMINIO_NO_DISPONIBLE")

    # ------------------------------------------------------------------
    def solicitar(self, data: SignupRequest, ip: Optional[str]) -> None:
        """Crea el registro pendiente y envía el enlace. Nunca revela si el correo ya existe."""
        telefono = normalizar_telefono(data.telefono)
        if not 7 <= len(telefono) <= 15:
            raise BusinessRuleException("El teléfono no es válido.", codigo="TELEFONO_INVALIDO")
        token = generate_cryptographic_token(32)
        ahora = datetime.now(timezone.utc)
        registro = RegistroAutonomo(
            nombre_gimnasio=data.nombre_gimnasio.strip(), ciudad=data.ciudad.strip(),
            jefe_nombre=data.jefe_nombre.strip(), jefe_correo=str(data.jefe_correo).lower().strip(),
            telefono=data.telefono.strip(), telefono_normalizado=telefono,
            subdominio_sugerido=SubdomainGenerator.slugify(data.nombre_gimnasio),
            token_hash=compute_sha256_hash(token),
            expira_en=ahora + timedelta(hours=settings.SIGNUP_TOKEN_HORAS),
            acepta_terminos_en=ahora, ip=ip,
        )
        self.db.add(registro)
        self.db.commit()

        enlace = f"{settings.URL_CONFIRMACION_REGISTRO.rstrip('/')}/{token}"
        self.correo.enviar(
            registro.jefe_correo,
            "Confirma el registro de tu gimnasio en GymOS",
            (
                f"Hola {registro.jefe_nombre}:\n\n"
                f"Para crear {registro.nombre_gimnasio} en GymOS con la prueba gratis, confirma tu correo "
                f"en este enlace (vale {settings.SIGNUP_TOKEN_HORAS} horas y sirve una sola vez):\n\n{enlace}\n\n"
                "Si no fuiste tú, ignora este mensaje."
            ),
        )

    def _registro_vigente(self, token: str) -> RegistroAutonomo:
        registro = self.db.query(RegistroAutonomo).filter(
            RegistroAutonomo.token_hash == compute_sha256_hash(token)
        ).first()
        if registro is None:
            raise EntityNotFoundException("Registro", "token", codigo="TOKEN_INVALIDO")
        if registro.usado_en is not None:
            raise GoneException("Este enlace ya se usó.", codigo="ENLACE_USADO")
        if _aware(registro.expira_en) <= datetime.now(timezone.utc):
            raise GoneException("El enlace venció. Vuelve a registrarte.", codigo="ENLACE_VENCIDO")
        return registro

    def consultar(self, token: str) -> RegistroAutonomo:
        return self._registro_vigente(token)

    def _prueba_ya_usada(self, registro: RegistroAutonomo) -> bool:
        usado = self.db.query(RegistroAutonomo.id).filter(
            RegistroAutonomo.usado_en.isnot(None),
            or_(RegistroAutonomo.jefe_correo == registro.jefe_correo,
                RegistroAutonomo.telefono_normalizado == registro.telefono_normalizado),
        ).first()
        jefe = self.db.query(CuentaJefe.id).filter(CuentaJefe.correo == registro.jefe_correo).first()
        return usado is not None or jefe is not None

    def confirmar(self, token: str, password: str) -> Tuple[str, str]:
        registro = self._registro_vigente(token)
        if self._prueba_ya_usada(registro):
            raise EntityConflictException(
                "Ya existe una prueba gratis con ese correo o teléfono.", codigo="PRUEBA_YA_USADA"
            )
        plan = self.db.query(PlanSuscripcion).filter(
            PlanSuscripcion.codigo == "prueba", PlanSuscripcion.activo.is_(True)
        ).first()
        if plan is None or plan.tipo != "prueba":
            raise BusinessRuleException("La prueba gratis no está disponible.", codigo="PLAN_NO_DISPONIBLE")
        subdominio = self._primer_subdominio_libre(registro.nombre_gimnasio)

        try:
            gym, _, _ = GymUseCases(self.db).provisionar(
                nombre=registro.nombre_gimnasio, subdominio=subdominio, plan=plan, tipo_inicio="prueba",
                valor_mensual=0, jefe_nombre=registro.jefe_nombre, jefe_correo=registro.jefe_correo,
                jefe_telefono=registro.telefono, hash_password=get_password_hash(password),
                password_temporal=False, actor_id=None, actor_nombre=ACTOR_REGISTRO,
                datos={"ciudad": registro.ciudad, "telefono": registro.telefono, "correo": registro.jefe_correo},
                accion_auditoria="REGISTRO_AUTONOMO_PRUEBA",
            )
            registro.usado_en = datetime.now(timezone.utc)
            registro.gimnasio_id = gym.id
            self.db.commit()
        except IntegrityError:
            # Carrera: otro registro confirmó el mismo correo/teléfono o tomó el subdominio.
            self.db.rollback()
            raise EntityConflictException(
                "Ya existe una prueba gratis con ese correo o teléfono.", codigo="PRUEBA_YA_USADA"
            )
        except Exception:
            self.db.rollback()
            raise
        return subdominio, f"https://{subdominio}.{settings.BASE_DOMAIN}/login"
