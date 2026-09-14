import json
from typing import Optional, List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import UsuarioInterno
from app.core.dependencies import get_current_admin_user
from app.infrastructure.repositories.audit_repository import AuditRepository
from app.presentation.schemas.audit_schemas import (
    AuditLogResponse, AuditChainVerificationResponse
)

router = APIRouter(prefix="/admin/audit", tags=["Auditoría Inmutable"])

@router.get("", response_model=List[AuditLogResponse], summary="Consultar traza inmutable de auditoría")
def list_audit_logs(
    gimnasio_id: Optional[str] = Query(None, description="Filtrar por gimnasio afectado"),
    actor_id: Optional[str] = Query(None, description="Filtrar por usuario autor"),
    accion: Optional[str] = Query(None, description="Filtrar por tipo de acción"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-25: Registrar y consultar de forma inmutable toda acción de escritura
    (actor real, acción, gimnasio afectado y detalle criptográfico con hash-chain).
    """
    repo = AuditRepository(db)
    items, total = repo.list_logs(
        gimnasio_id=gimnasio_id,
        actor_id=actor_id,
        accion=accion,
        limit=limit,
        offset=offset
    )

    response_list: List[AuditLogResponse] = []
    for a in items:
        # Format detalle safely to string or JSON string
        if isinstance(a.detalle, (dict, list)):
            detalle_str = json.dumps(a.detalle, indent=2)
        elif a.detalle is not None:
            detalle_str = str(a.detalle)
        else:
            detalle_str = None

        response_list.append(
            AuditLogResponse(
                id=a.id,
                gimnasio_id=str(a.gimnasio_id) if a.gimnasio_id else None,
                actor_id=str(a.actor_id) if a.actor_id else None,
                actor_nombre=a.actor_nombre,
                impersonando=a.impersonando,
                accion=a.accion,
                entidad=a.entidad,
                entidad_id=str(a.entidad_id) if a.entidad_id else None,
                detalle=detalle_str,
                hash_previo=a.hash_previo,
                hash_actual=a.hash_actual,
                created_at=a.created_at
            )
        )

    return response_list

@router.get("/verify-chain", response_model=AuditChainVerificationResponse, summary="Verificar integridad criptográfica de la cadena de hashes")
def verify_audit_hash_chain(
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RNF-03: Verifica que la cadena de bloques SHA-256 no haya sufrido alteraciones o inserciones ilegítimas.
    """
    repo = AuditRepository(db)
    is_valid, corrupted_id = repo.verify_integrity()
    total_records = db.query(repo.get_latest_entry().__class__).count() if repo.get_latest_entry() else 0

    if is_valid:
        msg = f"Cadena de auditoría 100% íntegra y válida ({total_records} registros analizados)."
    else:
        msg = f"ALERTA: Se detectó una alteración o corrupción en el registro con ID {corrupted_id}."

    return AuditChainVerificationResponse(
        cadena_integra=is_valid,
        total_registros_verificados=total_records,
        primer_registro_corrupto_id=corrupted_id,
        mensaje=msg
    )
