from datetime import date
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.infrastructure.database.session import get_db
from app.infrastructure.models.superadmin_models import UsuarioInterno, Auditoria
from app.infrastructure.repositories.gym_repository import GymRepository
from app.core.dependencies import get_current_admin_user
from app.application.use_cases.gym_use_cases import GymUseCases
from app.presentation.schemas.gym_schemas import (
    GymCreateStepByStep, GymUpdate, GymStateChangeRequest, GymCancelRequest,
    GymListItemResponse, GymDetailResponse, SubdomainCheckResponse,
    CredentialsIssuanceResponse, JefeResponse, SubscriptionResponse
)
from app.presentation.schemas.payment_schemas import PaymentResponse
from app.presentation.schemas.audit_schemas import AuditLogResponse
from app.core.config import settings

router = APIRouter(prefix="/admin/gyms", tags=["Gimnasios (Tenants)"])

@router.get("/check-subdomain", response_model=SubdomainCheckResponse, summary="Validar disponibilidad de subdominio en vivo")
def check_subdomain(
    subdomain: str = Query(..., min_length=2, max_length=50),
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-05: Autogenerar el subdominio a partir del nombre, editable, con validación de disponibilidad en vivo.
    """
    use_cases = GymUseCases(db)
    disponible, valido, mensaje = use_cases.check_subdomain(subdomain)
    return SubdomainCheckResponse(
        subdominio=subdomain,
        disponible=disponible,
        valido=valido,
        mensaje=mensaje
    )

@router.get("", response_model=List[GymListItemResponse], summary="Listar gimnasios con filtros y orden de urgencia")
def list_gyms(
    search: Optional[str] = Query(None, description="Búsqueda por nombre, subdominio, nit o ciudad"),
    estado: Optional[str] = Query(None, description="Filtrar por estado: prueba, activo, suspendido, cancelado"),
    order_by: str = Query("urgency", description="Orden: urgency (vencidos primero), nombre, fecha_corte, created_at"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-02 / RF-03: Tabla de gimnasios ordenada por urgencia (con los vencidos primero),
    búsqueda, filtro por estado y paginación.
    """
    repo = GymRepository(db)
    items, total = repo.list_gyms(
        search=search,
        estado=estado,
        order_by=order_by,
        limit=limit,
        offset=offset
    )

    today = date.today()
    result = []
    for g in items:
        dias_restantes = (g.fecha_corte - today).days if g.fecha_corte else None
        active_sub = g.suscripciones[0] if g.suscripciones else None
        result.append(
            GymListItemResponse(
                id=g.id,
                gimnasio_id=g.gimnasio_id,
                nombre=g.nombre,
                subdominio=g.subdominio,
                ciudad=g.ciudad,
                telefono=g.telefono,
                estado=g.estado,
                fecha_inicio=g.fecha_inicio,
                fecha_corte=g.fecha_corte,
                dias_restantes=dias_restantes,
                logo_url=g.logo_url,
                jefe_nombre=g.cuenta_jefe.nombre if g.cuenta_jefe else None,
                jefe_correo=g.cuenta_jefe.correo if g.cuenta_jefe else None,
                valor_mensual=float(active_sub.valor_mensual) if active_sub else None,
                created_at=g.created_at
            )
        )
    return result

@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED, summary="Crear gimnasio con provisioning asistido")
def create_gym(
    data: GymCreateStepByStep,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-04 / RF-06 / RF-11: Crear gimnasio mediante formulario multipaso:
    - Identidad
    - Imagen pública
    - Cuenta del Jefe
    - Suscripción inicial
    Provisiona tenant, cuenta del Jefe con clave temporal y emite credenciales copiables (RF-11).
    """
    use_cases = GymUseCases(db)
    gym, credentials = use_cases.create_gym(data, actor=current_user)

    return {
        "gimnasio": {
            "id": gym.id,
            "gimnasio_id": gym.gimnasio_id,
            "nombre": gym.nombre,
            "subdominio": gym.subdominio,
            "estado": gym.estado,
            "fecha_inicio": gym.fecha_inicio,
            "fecha_corte": gym.fecha_corte
        },
        "credenciales": credentials.model_dump()
    }

@router.get("/{gym_id}", response_model=GymDetailResponse, summary="Ver la ficha detallada de un gimnasio")
def get_gym_detail(
    gym_id: str,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-07: Ver la ficha del gimnasio: datos, estado, suscripción, cuenta del Jefe,
    historial de pagos y fechas operativas.
    """
    repo = GymRepository(db)
    gym = repo.get_by_id(gym_id)
    if not gym:
        from app.core.exceptions import EntityNotFoundException
        raise EntityNotFoundException("Gimnasio", gym_id)

    today = date.today()
    dias_restantes = (g.fecha_corte - today).days if (g := gym).fecha_corte else None

    # Jefe
    jefe_data = None
    if gym.cuenta_jefe:
        jefe_data = JefeResponse(
            id=gym.cuenta_jefe.id,
            nombre=gym.cuenta_jefe.nombre,
            correo=gym.cuenta_jefe.correo,
            telefono=gym.cuenta_jefe.telefono,
            password_cambiada=gym.cuenta_jefe.password_cambiada,
            ultimo_ingreso=gym.cuenta_jefe.ultimo_ingreso
        )

    # Subscriptions
    subs_list = [
        SubscriptionResponse(
            id=s.id,
            valor_mensual=float(s.valor_mensual),
            tipo_inicio=s.tipo_inicio,
            vigente_desde=s.vigente_desde,
            vigente_hasta=s.vigente_hasta
        )
        for s in gym.suscripciones
    ]
    suscripcion_actual = subs_list[0] if subs_list else None

    # Payments list (RF-07)
    payments_list = [
        PaymentResponse(
            id=p.id,
            gimnasio_id=p.gimnasio_id,
            monto=float(p.monto),
            meses=p.meses,
            fecha_pago=p.fecha_pago,
            metodo=p.metodo,
            nota=p.nota,
            anulado=p.anulado,
            motivo_anulacion=p.motivo_anulacion,
            anulado_en=p.anulado_en,
            idempotency_key=p.idempotency_key,
            created_at=p.created_at
        )
        for p in gym.pagos
    ]

    # Recent Audit activity for this gym (RF-07)
    recent_logs = db.query(Auditoria).filter(
        Auditoria.gimnasio_id == gym.id
    ).order_by(Auditoria.created_at.desc()).limit(20).all()

    audit_list = [
        AuditLogResponse(
            id=a.id,
            gimnasio_id=a.gimnasio_id,
            actor_id=a.actor_id,
            actor_nombre=a.actor_nombre,
            impersonando=a.impersonando,
            accion=a.accion,
            entidad=a.entidad,
            entidad_id=a.entidad_id,
            detalle=a.detalle,
            hash_previo=a.hash_previo,
            hash_actual=a.hash_actual,
            created_at=a.created_at
        )
        for a in recent_logs
    ]

    return GymDetailResponse(
        id=gym.id,
        gimnasio_id=gym.gimnasio_id,
        nombre=gym.nombre,
        subdominio=gym.subdominio,
        url_acceso=f"https://{gym.subdominio}.{settings.BASE_DOMAIN}",
        nit=gym.nit,
        direccion=gym.direccion,
        ciudad=gym.ciudad,
        telefono=gym.telefono,
        correo=gym.correo,
        estado=gym.estado,
        fecha_inicio=gym.fecha_inicio,
        fecha_corte=gym.fecha_corte,
        dias_restantes=dias_restantes,
        logo_url=gym.logo_url,
        banner_url=gym.banner_url,
        descripcion=gym.descripcion,
        instagram=gym.instagram,
        facebook=gym.facebook,
        whatsapp=gym.whatsapp,
        motivo_cancelacion=gym.motivo_cancelacion,
        fecha_cancelacion=gym.fecha_cancelacion,
        created_at=gym.created_at,
        updated_at=gym.updated_at,
        cuenta_jefe=jefe_data,
        suscripcion_actual=suscripcion_actual,
        suscripciones_historial=subs_list,
        total_pagos_registrados=len(gym.pagos),
        historial_pagos=payments_list,
        actividad_reciente=audit_list
    )

@router.put("/{gym_id}", response_model=GymDetailResponse, summary="Editar los datos del gimnasio")
def update_gym(
    gym_id: str,
    data: GymUpdate,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-08: Editar los datos del gimnasio (el subdominio es estrictamente inmutable tras la creación).
    """
    use_cases = GymUseCases(db)
    use_cases.update_gym(gym_id, data, actor=current_user)
    return get_gym_detail(gym_id=gym_id, db=db, current_user=current_user)

@router.patch("/{gym_id}/status", response_model=GymDetailResponse, summary="Cambiar el estado del gimnasio")
def change_gym_status(
    gym_id: str,
    data: GymStateChangeRequest,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-09: Cambiar el estado del gimnasio según la máquina de estados
    (prueba -> activo, activo <-> suspendido, * -> cancelado).
    """
    use_cases = GymUseCases(db)
    use_cases.change_state(gym_id, data.nuevo_estado, data.motivo, actor=current_user)
    return get_gym_detail(gym_id=gym_id, db=db, current_user=current_user)

@router.post("/{gym_id}/cancel", response_model=GymDetailResponse, summary="Cancelar un gimnasio formalmente")
def cancel_gym(
    gym_id: str,
    data: GymCancelRequest,
    db: Session = Depends(get_db),
    current_user: UsuarioInterno = Depends(get_current_admin_user)
):
    """
    RF-10: Cancelar un gimnasio (baja formal): congela el acceso y conserva los datos, no elimina.
    """
    use_cases = GymUseCases(db)
    use_cases.cancel_gym(gym_id, data.motivo, actor=current_user)
    return get_gym_detail(gym_id=gym_id, db=db, current_user=current_user)
