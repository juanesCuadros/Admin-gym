"""Cancelación con exportación ZIP y eliminación definitiva (§2.4, SA-RF-30, SA-RF-31; contrato 3.4).

El rol del SA no lee ni borra tablas del tenant: usa las funciones SECURITY DEFINER de la
migración 032 (superadmin.exportar_datos_tenant y superadmin.eliminar_datos_tenant).
"""
import csv
import io
import json
import logging
import os
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import (
    BusinessRuleException, EntityConflictException, EntityNotFoundException, GoneException
)
from app.core.fechas import fecha_bogota, hoy_bogota
from app.core.security import compute_sha256_hash, generate_cryptographic_token
from app.domain.services.ciclo_de_vida import DIAS_RETENCION_CANCELADO
from app.infrastructure.models.platform_models import Tenant
from app.infrastructure.models.superadmin_models import (
    CuentaJefe, EmisionCredenciales, ExportacionGimnasio, Gimnasio, ProvisioningPaso, UsuarioInterno
)
from app.infrastructure.repositories.audit_repository import AuditRepository

logger = logging.getLogger("gymos.exportaciones")

# Conjuntos exportados (SA-RF-30 CA1) → nombre del CSV dentro del ZIP.
CONJUNTOS = {
    "deportistas": "deportistas.csv",
    "membresias": "membresias.csv",
    "pagos": "pagos.csv",
    "asistencia": "asistencia.csv",
}


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _celda(valor) -> str:
    if valor is None:
        return ""
    if isinstance(valor, (dict, list)):
        return json.dumps(valor, ensure_ascii=False)
    if isinstance(valor, bool):
        return "true" if valor else "false"
    return str(valor)


class ExportUseCases:
    def __init__(self, db: Session):
        self.db = db
        self.audit_repo = AuditRepository(db)

    def _es_postgres(self) -> bool:
        return self.db.get_bind().dialect.name == "postgresql"

    def url_publica(self, token: str) -> str:
        return f"{settings.PUBLIC_API_BASE_URL.rstrip('/')}{settings.API_V1_STR}/public/exports/{token}"

    # ------------------------------------------------------------------
    def _csv(self, gym: Gimnasio, conjunto: str) -> bytes:
        datos = self.db.execute(
            text("SELECT superadmin.exportar_datos_tenant(CAST(:g AS uuid), :c)"),
            {"g": gym.gimnasio_id, "c": conjunto},
        ).scalar()
        if isinstance(datos, str):
            datos = json.loads(datos)
        columnas = datos["columnas"]
        salida = io.StringIO()
        w = csv.writer(salida)
        w.writerow(columnas)
        for fila in datos["filas"]:
            w.writerow([_celda(fila.get(c)) for c in columnas])
        return ("﻿" + salida.getvalue()).encode("utf-8")  # BOM: Excel abre bien las tildes

    def generar(self, gym: Gimnasio, actor_id: Optional[str]) -> Optional[Tuple[str, datetime, ExportacionGimnasio]]:
        """Genera el ZIP y el enlace de 30 días (sin commit). El gimnasio ya debe estar 'cancelado'
        en la transacción. Devuelve (token en claro, expira_en, registro).

        Requiere PostgreSQL (funciones de la 032); en la suite SQLite en memoria no se genera."""
        if not self._es_postgres():
            return None
        self.db.flush()
        export = ExportacionGimnasio(gimnasio_id=gym.id, token_hash="", ruta_archivo="", creada_por=actor_id,
                                     expira_en=datetime.now(timezone.utc) + timedelta(days=DIAS_RETENCION_CANCELADO))
        carpeta = Path(settings.EXPORTS_DIR) / gym.id
        carpeta.mkdir(parents=True, exist_ok=True)
        export.id = str(uuid.uuid4())
        ruta = carpeta / f"{export.id}.zip"
        with zipfile.ZipFile(ruta, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for conjunto, archivo in CONJUNTOS.items():
                z.writestr(archivo, self._csv(gym, conjunto))
        token = generate_cryptographic_token(32)
        export.token_hash = compute_sha256_hash(token)
        export.ruta_archivo = str(ruta.resolve())
        export.tamano_bytes = ruta.stat().st_size
        self.db.add(export)
        self.db.flush()
        self.audit_repo.record_action(
            actor_id=actor_id, actor_nombre="Sistema" if actor_id is None else self._nombre(actor_id),
            accion="EXPORTACION_GENERADA", entidad="exportaciones_gimnasio", entidad_id=export.id,
            gimnasio_id=gym.id,
            detalle={"archivos": list(CONJUNTOS.values()), "tamano_bytes": export.tamano_bytes,
                     "expira_en": export.expira_en.isoformat()},
            commit=False,
        )
        return token, export.expira_en, export

    def _nombre(self, actor_id: str) -> str:
        u = self.db.get(UsuarioInterno, actor_id)
        return u.nombre if u else "Desconocido"

    @staticmethod
    def borrar_archivo(ruta: Optional[str]) -> None:
        if ruta:
            try:
                os.remove(ruta)
            except FileNotFoundError:
                pass

    # ------------------------------------------------------------------
    def descargar(self, token: str, ip: Optional[str]) -> Tuple[str, str]:
        """GET /public/exports/{token}: 410 si venció, se eliminó o falta el archivo. Audita (CA3)."""
        export = self.db.query(ExportacionGimnasio).filter(
            ExportacionGimnasio.token_hash == compute_sha256_hash(token)
        ).first()
        if export is None:
            raise EntityNotFoundException("Exportación", "token", codigo="EXPORTACION_NO_ENCONTRADA")
        if export.eliminado_en is not None:
            raise GoneException("Los datos de este gimnasio ya se eliminaron.", codigo="EXPORTACION_ELIMINADA")
        if _aware(export.expira_en) <= datetime.now(timezone.utc):
            raise GoneException("El enlace de exportación venció.", codigo="EXPORTACION_VENCIDA")
        if not os.path.isfile(export.ruta_archivo):
            raise GoneException("El archivo de exportación ya no está disponible.", codigo="EXPORTACION_ELIMINADA")
        export.descargas = (export.descargas or 0) + 1
        self.audit_repo.record_action(
            actor_id=None, actor_nombre="Descarga pública", accion="EXPORTACION_DESCARGADA",
            entidad="exportaciones_gimnasio", entidad_id=export.id, gimnasio_id=export.gimnasio_id,
            detalle={"ip": ip, "descarga_numero": export.descargas}, commit=False,
        )
        self.db.commit()
        gym = self.db.get(Gimnasio, export.gimnasio_id)
        nombre = f"gymos-{gym.subdominio if gym else 'gimnasio'}-{fecha_bogota(export.created_at).isoformat()}.zip"
        return export.ruta_archivo, nombre

    # ------------------------------------------------------------------
    def eliminar_definitivo(self, gym_id: str, confirmar_subdominio: str, actor: UsuarioInterno) -> Gimnasio:
        """DELETE /admin/gyms/{id} (SA-RF-31): exige 30 días desde la cancelación y escribir el subdominio."""
        gym = self.db.query(Gimnasio).filter(Gimnasio.id == gym_id, Gimnasio.deleted_at.is_(None)).first()
        if gym is None:
            raise EntityNotFoundException("Gimnasio", gym_id)
        dias = None
        if gym.estado == "cancelado" and gym.fecha_cancelacion is not None:
            dias = (hoy_bogota() - fecha_bogota(gym.fecha_cancelacion)).days
        if dias is None or dias < DIAS_RETENCION_CANCELADO:
            raise EntityConflictException(
                f"Solo se puede eliminar un gimnasio cancelado hace {DIAS_RETENCION_CANCELADO} días o más.",
                details={"estado": gym.estado, "dias_desde_cancelacion": dias,
                         "dias_requeridos": DIAS_RETENCION_CANCELADO},
                codigo="AUN_NO_ELIMINABLE",
            )
        if (confirmar_subdominio or "").strip().lower() != gym.subdominio:
            raise BusinessRuleException(
                "Para confirmar escriba exactamente el subdominio del gimnasio.", codigo="CONFIRMACION_INVALIDA"
            )

        archivos = []
        try:
            if self._es_postgres():
                filas = self.db.execute(
                    text("SELECT superadmin.eliminar_datos_tenant(CAST(:g AS uuid))"), {"g": gym.gimnasio_id}
                ).scalar()
                for tabla in ("gimnasio_galeria", "sesiones_soporte"):
                    self.db.execute(text(f"DELETE FROM superadmin.{tabla} WHERE gimnasio_id = CAST(:g AS uuid)"),
                                    {"g": gym.id})
            else:
                tenant = self.db.get(Tenant, gym.gimnasio_id)
                filas = 0
                if tenant is not None:
                    self.db.delete(tenant)
                    filas = 1
            ahora = datetime.now(timezone.utc)
            for export in self.db.query(ExportacionGimnasio).filter(ExportacionGimnasio.gimnasio_id == gym.id):
                export.eliminado_en = ahora
                archivos.append(export.ruta_archivo)
            for modelo in (CuentaJefe, EmisionCredenciales, ProvisioningPaso):
                self.db.query(modelo).filter(modelo.gimnasio_id == gym.id).delete(synchronize_session=False)
            gym.deleted_at = ahora
            self.db.flush()
            # SA-RF-31 CA4: la auditoría conserva el evento, sin datos del tenant.
            self.audit_repo.record_action(
                actor_id=actor.id, actor_nombre=actor.nombre, accion="ELIMINACION_DEFINITIVA_GIMNASIO",
                entidad="gimnasios", entidad_id=gym.id, gimnasio_id=gym.id,
                detalle={"subdominio_liberado": gym.subdominio, "filas_tenant_eliminadas": int(filas or 0),
                         "dias_desde_cancelacion": dias},
                commit=False,
            )
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        for ruta in archivos:
            self.borrar_archivo(ruta)
        return gym
