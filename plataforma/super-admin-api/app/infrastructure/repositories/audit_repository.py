import json
from datetime import datetime, timezone
from typing import Optional, List, Tuple, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.infrastructure.models.superadmin_models import Auditoria
from app.core.security import compute_audit_hash

class AuditRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_latest_entry(self) -> Optional[Auditoria]:
        return self.db.query(Auditoria).order_by(Auditoria.id.desc()).first()

    def _canonical_iso(self, dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    def record_action(
        self,
        actor_id: Optional[str],
        actor_nombre: str,
        accion: str,
        entidad: str,
        entidad_id: Optional[str] = None,
        gimnasio_id: Optional[str] = None,
        detalle: Optional[Dict[str, Any]] = None,
        impersonando: bool = False
    ) -> Auditoria:
        """
        Creates an immutable, cryptographic hash-chained audit record (RF-25 / RNF-03).
        """
        latest = self.get_latest_entry()
        hash_previo = latest.hash_actual if latest else "0" * 64
        now_dt = datetime.now(timezone.utc)
        now_iso = self._canonical_iso(now_dt)

        # Sanitize sensitive data from details (RNF-01: secrets/passwords are never audited)
        sanitized_detalle = detalle.copy() if detalle else {}
        for sensitive_key in ["password", "contrasena", "secret", "temp_password", "hash_password"]:
            if sensitive_key in sanitized_detalle:
                sanitized_detalle[sensitive_key] = "[REDACTED_SECURITY]"

        detalle_str = json.dumps(sanitized_detalle, sort_keys=True)

        hash_actual = compute_audit_hash(
            hash_previo=hash_previo,
            actor_id=actor_id,
            accion=accion,
            entidad=entidad,
            entidad_id=entidad_id,
            detalle_str=detalle_str,
            created_at_iso=now_iso
        )

        audit_entry = Auditoria(
            gimnasio_id=gimnasio_id,
            actor_id=actor_id,
            actor_nombre=actor_nombre,
            impersonando=impersonando,
            accion=accion,
            entidad=entidad,
            entidad_id=entidad_id,
            detalle=detalle_str,
            hash_previo=hash_previo,
            hash_actual=hash_actual,
            created_at=now_dt
        )
        self.db.add(audit_entry)
        self.db.commit()
        self.db.refresh(audit_entry)
        return audit_entry

    def list_logs(
        self,
        gimnasio_id: Optional[str] = None,
        actor_id: Optional[str] = None,
        accion: Optional[str] = None,
        limit: int = 50,
        offset: int = 0
    ) -> Tuple[List[Auditoria], int]:
        query = self.db.query(Auditoria)
        if gimnasio_id:
            query = query.filter(Auditoria.gimnasio_id == gimnasio_id)
        if actor_id:
            query = query.filter(Auditoria.actor_id == actor_id)
        if accion:
            query = query.filter(Auditoria.accion == accion)

        total = query.count()
        items = query.order_by(Auditoria.id.desc()).offset(offset).limit(limit).all()
        return items, total

    def verify_integrity(self) -> Tuple[bool, Optional[int]]:
        """
        Verifies the cryptographic hash-chain across all audit records.
        Returns (True, None) if intact, or (False, broken_id) if tampered.
        """
        records = self.db.query(Auditoria).order_by(Auditoria.id.asc()).all()
        if not records:
            return True, None

        prev_hash = "0" * 64
        for r in records:
            if r.hash_previo != prev_hash:
                return False, r.id

            if isinstance(r.detalle, dict):
                det_str = json.dumps(r.detalle, sort_keys=True)
            elif r.detalle is not None:
                det_str = str(r.detalle)
            else:
                det_str = "{}"

            computed = compute_audit_hash(
                hash_previo=r.hash_previo,
                actor_id=str(r.actor_id) if r.actor_id else None,
                accion=r.accion,
                entidad=r.entidad,
                entidad_id=str(r.entidad_id) if r.entidad_id else None,
                detalle_str=det_str,
                created_at_iso=self._canonical_iso(r.created_at)
            )
            if computed != r.hash_actual:
                return False, r.id
            prev_hash = r.hash_actual

        return True, None
