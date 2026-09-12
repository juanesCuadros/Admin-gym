"""
Servicio de negocio para el Módulo 5: Membresías y Planes (RF-24 a RF-27, RF-42).
Gestiona catálogo de planes con versionado optimista, ciclo de vida de membresías,
cambio de plan sin prorrateo, cierre de congelamientos y auditoría inmutable.
"""
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.timezone import today_local
from app.modules.membresias.domain import MembresiaDomainService
from app.modules.membresias.schemas import (
    AsignarMembresiaRequest,
    CambiarEstadoPlanRequest,
    CambiarPlanRequest,
    CancelarMembresiaRequest,
    CongelarMembresiaRequest,
    CongelamientoItemResponse,
    CrearPlanRequest,
    EditarPlanRequest,
    FichaMembresiaResponse,
    MembresiaListItemResponse,
    MembresiaResponse,
    MembresiasPaginadasResponse,
    PlanResponse,
    PlanesListResponse,
)


class MembresiasService:
    """Orquestador de planes tarifarios, ciclo de vida de membresías y congelamientos."""

    # =========================================================================
    # 0. MÉTODOS AUXILIARES Y DE INTEGRIDAD COMPARTIDA
    # =========================================================================

    @classmethod
    async def _cerrar_congelamiento_si_existe(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        membresia_id: UUID,
        hoy: date,
    ) -> Optional[UUID]:
        """
        Cierra cualquier congelamiento activo huérfano (fecha_fin IS NULL).
        Invocado obligatoriamente por cancelar_membresia y cambiar_plan antes
        de marcar cancelada = true para preservar la integridad de datos.
        """
        q_find = text("""
            SELECT id, fecha_inicio FROM platform.congelamientos
            WHERE gimnasio_id = :gym_id AND membresia_id = :memb_id AND fecha_fin IS NULL
            FOR UPDATE
        """)
        res = await session.execute(q_find, {"gym_id": gym_id, "memb_id": membresia_id})
        cong = res.mappings().first()

        if not cong:
            return None

        dias_efectivos = max(1, (hoy - cong["fecha_inicio"]).days)
        q_close = text("""
            UPDATE platform.congelamientos
            SET fecha_fin = :hoy, dias = :dias
            WHERE id = :id
        """)
        await session.execute(q_close, {"hoy": hoy, "dias": dias_efectivos, "id": cong["id"]})
        return cong["id"]

    # =========================================================================
    # 1. CATÁLOGO DE PLANES TARIFARIOS (RF-24)
    # =========================================================================

    @classmethod
    async def crear_plan(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        req: CrearPlanRequest,
    ) -> PlanResponse:
        q_check = text("""
            SELECT id FROM platform.planes
            WHERE gimnasio_id = :gym_id AND LOWER(nombre) = LOWER(:nombre)
        """)
        res_check = await session.execute(q_check, {"gym_id": gym_id, "nombre": req.nombre})
        if res_check.first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "PLAN_YA_EXISTE", "mensaje": f"Ya existe un plan con el nombre '{req.nombre}' en este gimnasio"}
            )

        q_insert = text("""
            INSERT INTO platform.planes (
                gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo, version
            ) VALUES (
                :gym_id, :nombre, :precio, :duracion_dias, :tipo, :cupo_personas, true, 1
            ) RETURNING id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo, version, created_at, updated_at
        """)
        try:
            res = await session.execute(q_insert, {
                "gym_id": gym_id,
                "nombre": req.nombre,
                "precio": req.precio,
                "duracion_dias": req.duracion_dias,
                "tipo": req.tipo,
                "cupo_personas": req.cupo_personas,
            })
            plan = res.mappings().one()
        except IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "PLAN_YA_EXISTE", "mensaje": "Conflicto de unicidad al crear el plan"}
            )

        await AuditService.registrar_accion(
            session=session,
            gym_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CREAR_PLAN",
            entidad="planes",
            entidad_id=plan["id"],
            detalle={"nombre": req.nombre, "precio": float(req.precio), "duracion_dias": req.duracion_dias, "tipo": req.tipo}
        )

        return PlanResponse(**plan)

    @classmethod
    async def listar_planes(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        solo_activos: Optional[bool] = None,
    ) -> PlanesListResponse:
        cond_act = "AND activo = true" if solo_activos else ""
        q = text(f"""
            SELECT id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo, version, created_at, updated_at
            FROM platform.planes
            WHERE gimnasio_id = :gym_id {cond_act}
            ORDER BY activo DESC, nombre ASC
        """)
        res = await session.execute(q, {"gym_id": gym_id})
        items = [PlanResponse(**r) for r in res.mappings().all()]
        return PlanesListResponse(items=items, total=len(items))

    @classmethod
    async def obtener_plan(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        plan_id: UUID,
    ) -> PlanResponse:
        q = text("""
            SELECT id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo, version, created_at, updated_at
            FROM platform.planes
            WHERE id = :id AND gimnasio_id = :gym_id
        """)
        res = await session.execute(q, {"id": plan_id, "gym_id": gym_id})
        row = res.mappings().first()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PLAN_NO_ENCONTRADO", "mensaje": "Plan tarifario no encontrado"}
            )
        return PlanResponse(**row)

    @classmethod
    async def editar_plan(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        plan_id: UUID,
        req: EditarPlanRequest,
    ) -> PlanResponse:
        q_update = text("""
            UPDATE platform.planes
            SET nombre = COALESCE(:nombre, nombre),
                precio = COALESCE(:precio, precio),
                duracion_dias = COALESCE(:duracion_dias, duracion_dias),
                tipo = COALESCE(:tipo, tipo),
                cupo_personas = COALESCE(:cupo_personas, cupo_personas),
                version = version + 1,
                updated_at = now()
            WHERE id = :id AND gimnasio_id = :gym_id AND version = :version
            RETURNING id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo, version, created_at, updated_at
        """)
        try:
            res = await session.execute(q_update, {
                "id": plan_id,
                "gym_id": gym_id,
                "version": req.version,
                "nombre": req.nombre,
                "precio": req.precio,
                "duracion_dias": req.duracion_dias,
                "tipo": req.tipo,
                "cupo_personas": req.cupo_personas,
            })
            plan = res.mappings().first()
        except IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "PLAN_YA_EXISTE", "mensaje": "Ya existe otro plan con ese nombre"}
            )

        if not plan:
            q_exists = text("SELECT version FROM platform.planes WHERE id = :id AND gimnasio_id = :gym_id")
            res_ex = await session.execute(q_exists, {"id": plan_id, "gym_id": gym_id})
            row_ex = res_ex.mappings().first()
            if not row_ex:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "PLAN_NO_ENCONTRADO", "mensaje": "Plan no encontrado"}
                )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "CONFLICTO_CONCURRENCIA",
                    "mensaje": "El plan fue modificado por otro usuario. Recargue los datos para continuar",
                    "version_actual": row_ex["version"]
                }
            )

        await AuditService.registrar_accion(
            session=session,
            gym_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="EDITAR_PLAN",
            entidad="planes",
            entidad_id=plan["id"],
            detalle={"version_nueva": plan["version"]}
        )

        return PlanResponse(**plan)

    @classmethod
    async def cambiar_estado_plan(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        plan_id: UUID,
        req: CambiarEstadoPlanRequest,
    ) -> PlanResponse:
        """
        Activa o desactiva un plan tarifario.
        NO-RETROACTIVIDAD: Solo bloquea nuevas contrataciones. Las membresías
        vigentes asociadas al plan continúan operando con normalidad.
        """
        q = text("""
            UPDATE platform.planes
            SET activo = :activo, updated_at = now()
            WHERE id = :id AND gimnasio_id = :gym_id
            RETURNING id, gimnasio_id, nombre, precio, duracion_dias, tipo, cupo_personas, activo, version, created_at, updated_at
        """)
        res = await session.execute(q, {"id": plan_id, "gym_id": gym_id, "activo": req.activo})
        plan = res.mappings().first()
        if not plan:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PLAN_NO_ENCONTRADO", "mensaje": "Plan no encontrado"}
            )

        accion = "ACTIVAR_PLAN" if req.activo else "DESACTIVAR_PLAN"
        await AuditService.registrar_accion(
            session=session,
            gym_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion=accion,
            entidad="planes",
            entidad_id=plan["id"],
            detalle={"activo": req.activo}
        )

        return PlanResponse(**plan)

    # =========================================================================
    # 2. GESTIÓN DEL CICLO DE VIDA DE MEMBRESÍAS (RF-25, RF-27, RF-42)
    # =========================================================================

    @classmethod
    async def asignar_plan(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        req: AsignarMembresiaRequest,
    ) -> MembresiaResponse:
        """
        Asigna el plan inicial a un deportista sin membresía activa previa.
        Bloquea duplicados activos con 409 MEMBRESIA_ACTIVA_EXISTENTE.
        """
        # 1. Validar deportista
        q_dep = text("SELECT id, activo FROM platform.deportistas WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL")
        res_dep = await session.execute(q_dep, {"id": req.deportista_id, "gym_id": gym_id})
        dep = res_dep.mappings().first()
        if not dep:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado"}
            )

        # 2. Validar plan
        q_plan = text("SELECT id, nombre, duracion_dias, activo FROM platform.planes WHERE id = :id AND gimnasio_id = :gym_id")
        res_plan = await session.execute(q_plan, {"id": req.plan_id, "gym_id": gym_id})
        plan = res_plan.mappings().first()
        if not plan:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PLAN_NO_ENCONTRADO", "mensaje": "Plan tarifario no encontrado"}
            )
        if not plan["activo"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "PLAN_INACTIVO", "mensaje": "No se puede asignar un plan tarifario que se encuentra desactivado"}
            )

        # 3. Validar que no exista membresía activa previa (RF-25)
        q_activa = text("""
            SELECT id, fecha_vencimiento FROM platform.membresias
            WHERE gimnasio_id = :gym_id AND deportista_id = :deportista_id AND cancelada = false
            ORDER BY fecha_vencimiento DESC
            LIMIT 1
        """)
        res_activa = await session.execute(q_activa, {"gym_id": gym_id, "deportista_id": req.deportista_id})
        memb_activa = res_activa.mappings().first()
        if memb_activa:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "MEMBRESIA_ACTIVA_EXISTENTE",
                    "mensaje": "El deportista ya cuenta con una membresía activa vigente. Utilice la opción de cambiar de plan o renovar en Caja.",
                    "membresia_activa_id": str(memb_activa["id"]),
                    "fecha_vencimiento": str(memb_activa["fecha_vencimiento"])
                }
            )

        # 4. Calcular vigencia e insertar
        f_inicio = req.fecha_inicio or today_local()
        f_vencimiento = f_inicio + timedelta(days=plan["duracion_dias"])

        q_insert = text("""
            INSERT INTO platform.membresias (
                gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada
            ) VALUES (
                :gym_id, :deportista_id, :plan_id, :fini, :fvenc, false
            ) RETURNING id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada, created_at, updated_at
        """)
        res_ins = await session.execute(q_insert, {
            "gym_id": gym_id,
            "deportista_id": req.deportista_id,
            "plan_id": req.plan_id,
            "fini": f_inicio,
            "fvenc": f_vencimiento,
        })
        m = res_ins.mappings().one()

        await AuditService.registrar_accion(
            session=session,
            gym_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="ASIGNAR_MEMBRESIA",
            entidad="membresias",
            entidad_id=m["id"],
            detalle={"plan_nombre": plan["nombre"], "fecha_inicio": str(f_inicio), "fecha_vencimiento": str(f_vencimiento)}
        )

        hoy = today_local()
        calc = MembresiaDomainService.evaluar_estado_puro(
            hoy=hoy,
            activo_deportista=dep["activo"],
            tiene_membresia=True,
            fecha_vencimiento=f_vencimiento,
            membresia_id=m["id"],
            plan_nombre=plan["nombre"]
        )

        return MembresiaResponse(
            **m,
            plan_nombre=plan["nombre"],
            estado_calculado=calc.estado,
            dias_restantes_o_vencido=calc.dias_restantes_o_vencido,
            congelamiento_activo=False
        )

    @classmethod
    async def cambiar_plan(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        membresia_id: UUID,
        req: CambiarPlanRequest,
    ) -> MembresiaResponse:
        """
        Cambio de plan sin prorrateo (Opción A):
        1. Cierra congelamientos abiertos si existieran.
        2. Marca membresía anterior cancelada = true.
        3. Crea nueva membresía desde hoy con vigencia completa del nuevo plan.
        """
        hoy = today_local()

        # 1. Bloquear y validar membresía actual
        q_curr = text("""
            SELECT m.id, m.deportista_id, m.plan_id, m.cancelada, d.activo as deportista_activo
            FROM platform.membresias m
            JOIN platform.deportistas d ON d.id = m.deportista_id
            WHERE m.id = :id AND m.gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res_curr = await session.execute(q_curr, {"id": membresia_id, "gym_id": gym_id})
        curr = res_curr.mappings().first()
        if not curr:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "MEMBRESIA_NO_ENCONTRADA", "mensaje": "Membresía no encontrada"}
            )
        if curr["cancelada"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "MEMBRESIA_CANCELADA", "mensaje": "No se puede cambiar el plan de una membresía que ya está cancelada"}
            )

        # 2. Validar nuevo plan
        q_new = text("SELECT id, nombre, duracion_dias, activo FROM platform.planes WHERE id = :id AND gimnasio_id = :gym_id")
        res_new = await session.execute(q_new, {"id": req.nuevo_plan_id, "gym_id": gym_id})
        new_plan = res_new.mappings().first()
        if not new_plan:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PLAN_NO_ENCONTRADO", "mensaje": "Nuevo plan tarifario no encontrado"}
            )
        if not new_plan["activo"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "PLAN_INACTIVO", "mensaje": "No se puede cambiar a un plan tarifario que se encuentra desactivado"}
            )

        # 3. Cerrar cualquier congelamiento huérfano abierto
        await cls._cerrar_congelamiento_si_existe(session, gym_id, membresia_id, hoy)

        # 4. Cancelar membresía anterior
        q_cancel = text("""
            UPDATE platform.membresias
            SET cancelada = true, updated_at = now()
            WHERE id = :id
        """)
        await session.execute(q_cancel, {"id": membresia_id})

        # 5. Insertar nueva membresía desde hoy
        nueva_venc = hoy + timedelta(days=new_plan["duracion_dias"])
        q_ins = text("""
            INSERT INTO platform.membresias (
                gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada
            ) VALUES (
                :gym_id, :dep_id, :plan_id, :fini, :fvenc, false
            ) RETURNING id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada, created_at, updated_at
        """)
        res_ins = await session.execute(q_ins, {
            "gym_id": gym_id,
            "dep_id": curr["deportista_id"],
            "plan_id": new_plan["id"],
            "fini": hoy,
            "fvenc": nueva_venc,
        })
        nueva_m = res_ins.mappings().one()

        await AuditService.registrar_accion(
            session=session,
            gym_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CAMBIO_DE_PLAN",
            entidad="membresias",
            entidad_id=nueva_m["id"],
            detalle={
                "membresia_anterior_id": str(membresia_id),
                "nueva_membresia_id": str(nueva_m["id"]),
                "nuevo_plan_nombre": new_plan["nombre"],
                "motivo": req.motivo or "CAMBIO_DE_PLAN"
            }
        )

        calc = MembresiaDomainService.evaluar_estado_puro(
            hoy=hoy,
            activo_deportista=curr["deportista_activo"],
            tiene_membresia=True,
            fecha_vencimiento=nueva_venc,
            membresia_id=nueva_m["id"],
            plan_nombre=new_plan["nombre"]
        )

        return MembresiaResponse(
            **nueva_m,
            plan_nombre=new_plan["nombre"],
            estado_calculado=calc.estado,
            dias_restantes_o_vencido=calc.dias_restantes_o_vencido,
            congelamiento_activo=False
        )

    @classmethod
    async def cancelar_membresia(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        membresia_id: UUID,
        req: CancelarMembresiaRequest,
    ) -> Dict[str, Any]:
        hoy = today_local()
        q_curr = text("""
            SELECT id, cancelada FROM platform.membresias
            WHERE id = :id AND gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res_curr = await session.execute(q_curr, {"id": membresia_id, "gym_id": gym_id})
        curr = res_curr.mappings().first()
        if not curr:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "MEMBRESIA_NO_ENCONTRADA", "mensaje": "Membresía no encontrada"}
            )
        if curr["cancelada"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "YA_CANCELADA", "mensaje": "La membresía ya se encuentra cancelada"}
            )

        # Cerrar congelamiento abierto si existiera
        await cls._cerrar_congelamiento_si_existe(session, gym_id, membresia_id, hoy)

        # Cancelar
        q_canc = text("UPDATE platform.membresias SET cancelada = true, updated_at = now() WHERE id = :id")
        await session.execute(q_canc, {"id": membresia_id})

        await AuditService.registrar_accion(
            session=session,
            gym_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CANCELAR_MEMBRESIA",
            entidad="membresias",
            entidad_id=membresia_id,
            detalle={"motivo": req.motivo}
        )

        return {"mensaje": "Membresía cancelada exitosamente", "membresia_id": str(membresia_id)}

    # =========================================================================
    # 3. CONGELAMIENTO Y DESCONGELAMIENTO (RF-26)
    # =========================================================================

    @classmethod
    async def congelar_membresia(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        membresia_id: UUID,
        req: CongelarMembresiaRequest,
    ) -> CongelamientoItemResponse:
        hoy = today_local()

        # 1. Validar membresía
        q_m = text("""
            SELECT id, fecha_vencimiento, cancelada
            FROM platform.membresias
            WHERE id = :id AND gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res_m = await session.execute(q_m, {"id": membresia_id, "gym_id": gym_id})
        m = res_m.mappings().first()
        if not m:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "MEMBRESIA_NO_ENCONTRADA", "mensaje": "Membresía no encontrada"}
            )
        if m["cancelada"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "MEMBRESIA_CANCELADA", "mensaje": "No se puede congelar una membresía cancelada"}
            )
        if m["fecha_vencimiento"] < hoy:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "MEMBRESIA_VENCIDA", "mensaje": "No se puede congelar una membresía vencida"}
            )

        # 2. Anticipar congelamiento activo vigente (409 CONFLICT)
        q_open = text("""
            SELECT id FROM platform.congelamientos
            WHERE gimnasio_id = :gym_id AND membresia_id = :memb_id AND fecha_fin IS NULL
        """)
        res_open = await session.execute(q_open, {"gym_id": gym_id, "memb_id": membresia_id})
        if res_open.mappings().first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "MEMBRESIA_YA_CONGELADA", "mensaje": "La membresía ya se encuentra congelada actualmente"}
            )

        # 3. Validar tope de días configurable por gimnasio
        q_tope = text("SELECT tope_dias_congelamiento FROM platform.tenant WHERE id = :gym_id")
        res_tope = await session.execute(q_tope, {"gym_id": gym_id})
        tope = res_tope.scalar() or 30

        q_prev = text("""
            SELECT COALESCE(SUM(dias), 0) FROM platform.congelamientos
            WHERE gimnasio_id = :gym_id AND membresia_id = :memb_id AND fecha_fin IS NOT NULL
        """)
        res_prev = await session.execute(q_prev, {"gym_id": gym_id, "memb_id": membresia_id})
        dias_consumidos = res_prev.scalar() or 0

        if dias_consumidos >= tope:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "codigo": "TOPE_CONGELAMIENTO_ALCANZADO",
                    "mensaje": f"Se ha alcanzado el tope máximo de {tope} días de congelamiento permitidos para esta membresía"
                }
            )

        # 4. Insertar congelamiento abierto
        q_ins = text("""
            INSERT INTO platform.congelamientos (
                gimnasio_id, membresia_id, fecha_inicio, fecha_fin, registrado_por
            ) VALUES (
                :gym_id, :memb_id, :hoy, NULL, :staff_id
            ) RETURNING id, fecha_inicio, fecha_fin, dias, created_at
        """)
        try:
            res_ins = await session.execute(q_ins, {
                "gym_id": gym_id,
                "memb_id": membresia_id,
                "hoy": hoy,
                "staff_id": staff_id,
            })
            cong = res_ins.mappings().one()
        except IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "MEMBRESIA_YA_CONGELADA", "mensaje": "Conflicto concurrente: la membresía ya fue congelada"}
            )

        await AuditService.registrar_accion(
            session=session,
            gym_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CONGELAR_MEMBRESIA",
            entidad="congelamientos",
            entidad_id=cong["id"],
            detalle={"membresia_id": str(membresia_id), "fecha_inicio": str(hoy), "motivo": req.motivo}
        )

        return CongelamientoItemResponse(
            id=cong["id"],
            fecha_inicio=cong["fecha_inicio"],
            fecha_fin=None,
            dias=None,
            vigente=True,
            registrado_por_nombre=staff_nombre,
            created_at=cong["created_at"]
        )

    @classmethod
    async def descongelar_membresia(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        membresia_id: UUID,
    ) -> CongelamientoItemResponse:
        hoy = today_local()

        # 1. Bloquear y obtener congelamiento vigente
        q_open = text("""
            SELECT id, fecha_inicio FROM platform.congelamientos
            WHERE gimnasio_id = :gym_id AND membresia_id = :memb_id AND fecha_fin IS NULL
            FOR UPDATE
        """)
        res_open = await session.execute(q_open, {"gym_id": gym_id, "memb_id": membresia_id})
        cong = res_open.mappings().first()
        if not cong:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "MEMBRESIA_NO_CONGELADA", "mensaje": "La membresía no tiene un congelamiento vigente activo"}
            )

        # 2. Obtener tope y días consumidos previos
        q_tope = text("SELECT tope_dias_congelamiento FROM platform.tenant WHERE id = :gym_id")
        res_tope = await session.execute(q_tope, {"gym_id": gym_id})
        tope = res_tope.scalar() or 30

        q_prev = text("""
            SELECT COALESCE(SUM(dias), 0) FROM platform.congelamientos
            WHERE gimnasio_id = :gym_id AND membresia_id = :memb_id AND fecha_fin IS NOT NULL
        """)
        res_prev = await session.execute(q_prev, {"gym_id": gym_id, "memb_id": membresia_id})
        dias_previos = res_prev.scalar() or 0

        dias_reales = max(1, (hoy - cong["fecha_inicio"]).days)
        dias_disponibles = max(0, tope - dias_previos)
        dias_a_extender = min(dias_reales, dias_disponibles)

        # 3. Cerrar congelamiento y extender vigencia
        q_close = text("""
            UPDATE platform.congelamientos
            SET fecha_fin = :hoy, dias = :dias
            WHERE id = :id
            RETURNING id, fecha_inicio, fecha_fin, dias, created_at
        """)
        res_close = await session.execute(q_close, {"hoy": hoy, "dias": dias_reales, "id": cong["id"]})
        closed_cong = res_close.mappings().one()

        if dias_a_extender > 0:
            q_ext = text("""
                UPDATE platform.membresias
                SET fecha_vencimiento = fecha_vencimiento + CAST(:dias AS integer), updated_at = now()
                WHERE id = :id
            """)
            await session.execute(q_ext, {"dias": dias_a_extender, "id": membresia_id})

        await AuditService.registrar_accion(
            session=session,
            gym_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="DESCONGELAR_MEMBRESIA",
            entidad="congelamientos",
            entidad_id=cong["id"],
            detalle={
                "membresia_id": str(membresia_id),
                "dias_reales": dias_reales,
                "dias_extendidos": dias_a_extender,
                "tope_aplicado": dias_a_extender < dias_reales
            }
        )

        return CongelamientoItemResponse(
            id=closed_cong["id"],
            fecha_inicio=closed_cong["fecha_inicio"],
            fecha_fin=closed_cong["fecha_fin"],
            dias=closed_cong["dias"],
            vigente=False,
            registrado_por_nombre=staff_nombre,
            created_at=closed_cong["created_at"]
        )

    # =========================================================================
    # 4. LISTADOS Y REPORTES ACCIONABLES (RF-27, RF-42)
    # =========================================================================

    @classmethod
    async def listar_membresias(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        estado: Optional[str] = None,
        q: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> MembresiasPaginadasResponse:
        """
        Listado paginado de membresías.
        Consulta cruda + batch query de congelamientos en MembresiaDomainService.
        CERO divergencia SQL y CERO problema N+1.
        """
        cond_q = ""
        params: Dict[str, Any] = {"gym_id": gym_id, "limit": limit, "skip": skip}
        if q:
            cond_q = "AND (d.documento ILIKE :q_text OR d.nombre ILIKE :q_text)"
            params["q_text"] = f"%{q.strip()}%"

        q_count = text(f"""
            SELECT COUNT(*)
            FROM platform.membresias m
            JOIN platform.deportistas d ON d.id = m.deportista_id
            WHERE m.gimnasio_id = :gym_id AND d.deleted_at IS NULL {cond_q}
        """)
        res_count = await session.execute(q_count, params)
        total = res_count.scalar() or 0

        q_items = text(f"""
            SELECT m.id, m.deportista_id, d.nombre as deportista_nombre, d.documento as deportista_documento,
                   d.correo as deportista_correo, d.telefono as deportista_telefono, d.activo as deportista_activo,
                   m.plan_id, p.nombre as plan_nombre, m.fecha_inicio, m.fecha_vencimiento, m.cancelada
            FROM platform.membresias m
            JOIN platform.deportistas d ON d.id = m.deportista_id
            JOIN platform.planes p ON p.id = m.plan_id
            WHERE m.gimnasio_id = :gym_id AND d.deleted_at IS NULL {cond_q}
            ORDER BY m.fecha_vencimiento DESC, m.created_at DESC
            OFFSET :skip LIMIT :limit
        """)
        res_items = await session.execute(q_items, params)
        raw_items = [dict(r) for r in res_items.mappings().all()]

        # Enriquecer en memoria con una sola consulta batch para congelamientos
        q_params = text("SELECT dias_gracia_mora, dias_umbral_por_vencer FROM platform.tenant WHERE id = :gym_id")
        res_t = await session.execute(q_params, {"gym_id": gym_id})
        t_row = res_t.mappings().first()
        gracia = t_row["dias_gracia_mora"] if t_row else 3
        umbral = t_row["dias_umbral_por_vencer"] if t_row else 5

        enriquecidos = await MembresiaDomainService.enriquecer_membresias_batch(
            session=session,
            gym_id=gym_id,
            items=raw_items,
            dias_gracia_mora=gracia,
            dias_umbral_por_vencer=umbral
        )

        if estado:
            enriquecidos = [item for item in enriquecidos if item["estado_calculado"] == estado]

        dto_items = [MembresiaListItemResponse(**item) for item in enriquecidos]
        return MembresiasPaginadasResponse(items=dto_items, total=total, skip=skip, limit=limit)

    @classmethod
    async def obtener_ficha_membresia(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        membresia_id: UUID,
    ) -> FichaMembresiaResponse:
        # 1. Membresía con deportista y plan
        q_m = text("""
            SELECT m.id, m.gimnasio_id, m.deportista_id, m.plan_id, p.nombre as plan_nombre,
                   m.fecha_inicio, m.fecha_vencimiento, m.cancelada, m.created_at, m.updated_at,
                   d.activo as deportista_activo
            FROM platform.membresias m
            JOIN platform.planes p ON p.id = m.plan_id
            JOIN platform.deportistas d ON d.id = m.deportista_id
            WHERE m.id = :id AND m.gimnasio_id = :gym_id
        """)
        res_m = await session.execute(q_m, {"id": membresia_id, "gym_id": gym_id})
        m = res_m.mappings().first()
        if not m:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "MEMBRESIA_NO_ENCONTRADA", "mensaje": "Membresía no encontrada"}
            )

        # 2. Congelamientos
        q_cong = text("""
            SELECT c.id, c.fecha_inicio, c.fecha_fin, c.dias, c.created_at, s.nombre as registrado_por_nombre
            FROM platform.congelamientos c
            LEFT JOIN platform.staff s ON s.id = c.registrado_por
            WHERE c.gimnasio_id = :gym_id AND c.membresia_id = :m_id
            ORDER BY c.fecha_inicio DESC
        """)
        res_cong = await session.execute(q_cong, {"gym_id": gym_id, "m_id": membresia_id})
        congelamientos = []
        congelamiento_activo_id = None
        for r in res_cong.mappings().all():
            es_vigente = r["fecha_fin"] is None
            if es_vigente:
                congelamiento_activo_id = r["id"]
            congelamientos.append(CongelamientoItemResponse(
                id=r["id"],
                fecha_inicio=r["fecha_inicio"],
                fecha_fin=r["fecha_fin"],
                dias=r["dias"],
                vigente=es_vigente,
                registrado_por_nombre=r["registrado_por_nombre"],
                created_at=r["created_at"]
            ))

        # 3. Pagos
        q_pagos = text("""
            SELECT id, monto, metodo, tipo_medio, dias_agregados, anulado, created_at
            FROM platform.pagos_membresia
            WHERE gimnasio_id = :gym_id AND membresia_id = :m_id
            ORDER BY created_at DESC
        """)
        res_pagos = await session.execute(q_pagos, {"gym_id": gym_id, "m_id": membresia_id})
        pagos = [dict(r) for r in res_pagos.mappings().all()]

        # 4. Estado calculado
        hoy = today_local()
        calc = MembresiaDomainService.evaluar_estado_puro(
            hoy=hoy,
            activo_deportista=m["deportista_activo"],
            tiene_membresia=not m["cancelada"],
            ultima_cancelada=m["cancelada"],
            fecha_vencimiento=m["fecha_vencimiento"],
            congelamiento_activo=bool(congelamiento_activo_id),
            congelamiento_id=congelamiento_activo_id,
            membresia_id=m["id"],
            plan_nombre=m["plan_nombre"]
        )

        resp_dto = MembresiaResponse(
            id=m["id"],
            gimnasio_id=m["gimnasio_id"],
            deportista_id=m["deportista_id"],
            plan_id=m["plan_id"],
            plan_nombre=m["plan_nombre"],
            fecha_inicio=m["fecha_inicio"],
            fecha_vencimiento=m["fecha_vencimiento"],
            cancelada=m["cancelada"],
            estado_calculado=calc.estado,
            dias_restantes_o_vencido=calc.dias_restantes_o_vencido,
            congelamiento_activo=bool(congelamiento_activo_id),
            congelamiento_id=congelamiento_activo_id,
            created_at=m["created_at"],
            updated_at=m["updated_at"]
        )

        return FichaMembresiaResponse(
            membresia=resp_dto,
            congelamientos=congelamientos,
            pagos=pagos
        )

    @classmethod
    async def obtener_membresias_deportista(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        deportista_id: UUID,
    ) -> List[MembresiaResponse]:
        # Validar deportista
        q_dep = text("SELECT id, activo FROM platform.deportistas WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL")
        res_dep = await session.execute(q_dep, {"id": deportista_id, "gym_id": gym_id})
        dep = res_dep.mappings().first()
        if not dep:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado"}
            )

        q = text("""
            SELECT m.id, m.gimnasio_id, m.deportista_id, m.plan_id, p.nombre as plan_nombre,
                   m.fecha_inicio, m.fecha_vencimiento, m.cancelada, m.created_at, m.updated_at
            FROM platform.membresias m
            JOIN platform.planes p ON p.id = m.plan_id
            WHERE m.gimnasio_id = :gym_id AND m.deportista_id = :dep_id
            ORDER BY m.fecha_vencimiento DESC, m.created_at DESC
        """)
        res = await session.execute(q, {"gym_id": gym_id, "dep_id": deportista_id})
        raw_items = [dict(r) for r in res.mappings().all()]

        q_params = text("SELECT dias_gracia_mora, dias_umbral_por_vencer FROM platform.tenant WHERE id = :gym_id")
        res_t = await session.execute(q_params, {"gym_id": gym_id})
        t_row = res_t.mappings().first()
        gracia = t_row["dias_gracia_mora"] if t_row else 3
        umbral = t_row["dias_umbral_por_vencer"] if t_row else 5

        enriquecidos = await MembresiaDomainService.enriquecer_membresias_batch(
            session=session,
            gym_id=gym_id,
            items=raw_items,
            dias_gracia_mora=gracia,
            dias_umbral_por_vencer=umbral
        )

        return [MembresiaResponse(**item) for item in enriquecidos]
