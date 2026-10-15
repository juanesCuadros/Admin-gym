"""
Servicio de negocio para el Módulo 5: Membresías y Planes (RF-24 a RF-27, RF-42).
Gestiona catálogo de planes con versionado optimista, ciclo de vida de membresías,
cambio de plan sin prorrateo, cierre de congelamientos y auditoría inmutable.
"""
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.timezone import today_local
from app.modules.caja.reglas import calcular_vencimiento_renovacion_c2
from app.modules.caja.schemas import PagoMembresiaResponseDto, RegistrarPagoMembresiaRequest
from app.modules.caja.service import CajaService
from app.modules.membresias.domain import MembresiaDomainService
from app.modules.membresias.schemas import (
    AsignarMembresiaRequest,
    CambiarEstadoPlanRequest,
    CambiarPlanRequest,
    CancelarMembresiaRequest,
    CongelarMembresiaRequest,
    CongelamientoItemResponse,
    CrearPaqueteRequest,
    CrearPaqueteResponse,
    CrearPlanRequest,
    DetallePaqueteResponse,
    EditarPlanRequest,
    FichaMembresiaResponse,
    MembresiaListItemResponse,
    MembresiaResponse,
    MembresiasPaginadasResponse,
    PagoVentaDto,
    PaqueteMembresiaItemDto,
    PlanResponse,
    PlanesListResponse,
    TitularResumenDto,
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

    @staticmethod
    def _clave_en_uso() -> HTTPException:
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "codigo": "CLAVE_IDEMPOTENCIA_EN_USO",
                "mensaje": "Esa clave de cobro ya se usó en otra operación. Recarga e inténtalo de nuevo.",
            },
        )

    @classmethod
    async def _venta_previa(
        cls, session: AsyncSession, gym_id: UUID, idempotency_key: str
    ) -> Optional[PagoMembresiaResponseDto]:
        """Pago ya registrado con esta clave: el reintento devuelve la venta original sin repetirla."""
        return await CajaService._consultar_pago_membresia_existente_por_key(session, gym_id, idempotency_key.strip())

    @classmethod
    async def _respuesta_venta_previa(
        cls, session: AsyncSession, gym_id: UUID, previo: PagoMembresiaResponseDto, deportista_id: UUID
    ) -> MembresiaResponse:
        if previo.membresia_id is None:
            raise cls._clave_en_uso()
        ficha = await cls.obtener_ficha_membresia(session, gym_id, previo.membresia_id)
        if ficha.membresia.deportista_id != deportista_id:
            raise cls._clave_en_uso()
        return ficha.membresia.model_copy(update={"pago": previo})

    @classmethod
    async def _cobrar_venta(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_rol: str,
        staff_nombre: str,
        idempotency_key: str,
        pago: PagoVentaDto,
        membresia_id: Optional[UUID] = None,
        paquete_id: Optional[UUID] = None,
    ) -> PagoMembresiaResponseDto:
        """Registra el cobro de la venta en el turno propio, en la misma transacción que la membresía."""
        return await CajaService.registrar_pago_membresia(
            session=session,
            gym_id=gym_id,
            staff_id=staff_id,
            staff_rol=staff_rol,
            staff_nombre=staff_nombre,
            idempotency_key=idempotency_key,
            data=RegistrarPagoMembresiaRequest(
                membresia_id=membresia_id,
                paquete_id=paquete_id,
                monto=pago.monto,
                metodo=pago.metodo,
                tipo_medio=pago.tipo_medio,
                dias_agregados=0,
                valor_recibido=pago.valor_recibido,
                precio_cobrado=pago.precio_cobrado,
                motivo_descuento=pago.motivo_descuento,
            ),
            venta=True,
        )

    @classmethod
    async def _obtener_config_tenant(cls, session: AsyncSession, gym_id: UUID) -> Tuple[int, int]:
        """Obtiene dias_gracia_mora y dias_umbral_por_vencer configurados para el gimnasio."""
        q = text("SELECT dias_gracia_mora, dias_umbral_por_vencer FROM platform.tenant WHERE id = :gym_id")
        res = await session.execute(q, {"gym_id": gym_id})
        row = res.mappings().first()
        gracia = row["dias_gracia_mora"] if row and row["dias_gracia_mora"] is not None else 3
        umbral = row["dias_umbral_por_vencer"] if row and row["dias_umbral_por_vencer"] is not None else 5
        return gracia, umbral

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

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
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

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
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
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
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
        staff_rol: str = "",
        idempotency_key: str = "",
    ) -> MembresiaResponse:
        """
        Vende el plan inicial a un deportista sin membresía previa: crea la membresía (inicio + duración)
        y registra su cobro en el turno propio, todo en la misma transacción. El cobro no suma días.
        Bloquea duplicados activos con 409 MEMBRESIA_ACTIVA_EXISTENTE.
        """
        # 1. Validar y bloquear deportista como mutex de concurrencia (evita TOCTOU)
        q_dep = text("""
            SELECT id, activo 
            FROM platform.deportistas 
            WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL 
            FOR UPDATE
        """)
        res_dep = await session.execute(q_dep, {"id": req.deportista_id, "gym_id": gym_id})
        dep = res_dep.mappings().first()
        if not dep:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado"}
            )

        # Reintento de la misma venta (con el deportista ya bloqueado): devuelve la original.
        previo = await cls._venta_previa(session, gym_id, idempotency_key)
        if previo:
            return await cls._respuesta_venta_previa(session, gym_id, previo, req.deportista_id)

        # 2. Validar plan
        q_plan = text("SELECT id, nombre, precio, duracion_dias, activo FROM platform.planes WHERE id = :id AND gimnasio_id = :gym_id")
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
                gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada,
                plan_precio_vendido, plan_duracion_dias_vendida
            ) VALUES (
                :gym_id, :deportista_id, :plan_id, :fini, :fvenc, false,
                :plan_precio_vendido, :plan_duracion_dias_vendida
            ) RETURNING id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada,
                        plan_precio_vendido, plan_duracion_dias_vendida, created_at, updated_at
        """)
        res_ins = await session.execute(q_insert, {
            "gym_id": gym_id,
            "deportista_id": req.deportista_id,
            "plan_id": req.plan_id,
            "fini": f_inicio,
            "fvenc": f_vencimiento,
            "plan_precio_vendido": plan["precio"],
            "plan_duracion_dias_vendida": plan["duracion_dias"],
        })
        m = res_ins.mappings().one()

        pago = await cls._cobrar_venta(
            session, gym_id, staff_id, staff_rol, staff_nombre, idempotency_key, req.pago, membresia_id=m["id"]
        )

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="ASIGNAR_MEMBRESIA",
            entidad="membresias",
            entidad_id=m["id"],
            detalle={
                "plan_nombre": plan["nombre"],
                "fecha_inicio": str(f_inicio),
                "fecha_vencimiento": str(f_vencimiento),
                "pago_id": str(pago.id),
                "monto": float(pago.monto),
            }
        )

        hoy = today_local()
        gracia, umbral = await cls._obtener_config_tenant(session, gym_id)
        calc = MembresiaDomainService.evaluar_estado_puro(
            hoy=hoy,
            activo_deportista=dep["activo"],
            tiene_membresia=True,
            fecha_vencimiento=f_vencimiento,
            dias_gracia_mora=gracia,
            dias_umbral_por_vencer=umbral,
            membresia_id=m["id"],
            plan_nombre=plan["nombre"]
        )

        return MembresiaResponse(
            **m,
            plan_nombre=plan["nombre"],
            estado_calculado=calc.estado,
            dias_restantes_o_vencido=calc.dias_restantes_o_vencido,
            congelamiento_activo=False,
            pago=pago,
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
        staff_rol: str = "",
        idempotency_key: str = "",
    ) -> MembresiaResponse:
        """
        Cambio de plan sin prorrateo y sin pérdida de días (GW-RF-25 CA3), cobrado en el mismo paso:
        1. Rechaza el cambio si la membresía está congelada hoy (hay que descongelarla primero).
        2. El plan nuevo empieza cuando termina el actual. Si ya venció, aplica la regla C2.
        3. Marca la membresía anterior cancelada = true y crea la nueva con su cobro de venta.
        """
        hoy = today_local()

        # 1. Bloquear y validar membresía actual
        q_curr = text("""
            SELECT m.id, m.deportista_id, m.plan_id, m.cancelada, m.fecha_vencimiento,
                   d.activo as deportista_activo
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
        # Reintento del mismo cambio (con la membresía ya bloqueada): devuelve el original.
        previo = await cls._venta_previa(session, gym_id, idempotency_key)
        if previo:
            return await cls._respuesta_venta_previa(session, gym_id, previo, curr["deportista_id"])

        if curr["cancelada"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "MEMBRESIA_CANCELADA", "mensaje": "No se puede cambiar el plan de una membresía que ya está cancelada"}
            )

        res_cong = await session.execute(
            text("""
                SELECT 1 FROM platform.congelamientos
                WHERE gimnasio_id = :gym_id AND membresia_id = :memb_id
                  AND fecha_inicio <= :hoy AND (fecha_fin IS NULL OR fecha_fin > :hoy)
                LIMIT 1
            """),
            {"gym_id": gym_id, "memb_id": membresia_id, "hoy": hoy},
        )
        if res_cong.first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "MEMBRESIA_CONGELADA", "mensaje": "Descongela la membresía antes de cambiar de plan."}
            )

        # 2. Validar nuevo plan
        q_new = text("SELECT id, nombre, precio, duracion_dias, activo FROM platform.planes WHERE id = :id AND gimnasio_id = :gym_id")
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

        # 5. Insertar la nueva membresía: empieza cuando termina la actual (CA3); si ya venció, regla C2.
        gracia, umbral = await cls._obtener_config_tenant(session, gym_id)
        venc_actual: date = curr["fecha_vencimiento"]
        checkin_en_gracia = False
        if venc_actual < hoy:
            checkin_en_gracia = await CajaService.tuvo_checkin_en_gracia(
                session, gym_id, curr["deportista_id"], venc_actual, gracia
            )
        f_inicio_nueva, nueva_venc = calcular_vencimiento_renovacion_c2(
            venc_actual=venc_actual,
            hoy=hoy,
            dias_duracion=new_plan["duracion_dias"],
            dias_gracia_mora=gracia,
            tuvo_checkin_en_gracia=checkin_en_gracia,
        )
        q_ins = text("""
            INSERT INTO platform.membresias (
                gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada,
                plan_precio_vendido, plan_duracion_dias_vendida
            ) VALUES (
                :gym_id, :dep_id, :plan_id, :fini, :fvenc, false,
                :plan_precio_vendido, :plan_duracion_dias_vendida
            ) RETURNING id, gimnasio_id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada,
                        plan_precio_vendido, plan_duracion_dias_vendida, created_at, updated_at
        """)
        res_ins = await session.execute(q_ins, {
            "gym_id": gym_id,
            "dep_id": curr["deportista_id"],
            "plan_id": new_plan["id"],
            "fini": f_inicio_nueva,
            "fvenc": nueva_venc,
            "plan_precio_vendido": new_plan["precio"],
            "plan_duracion_dias_vendida": new_plan["duracion_dias"],
        })
        nueva_m = res_ins.mappings().one()

        pago = await cls._cobrar_venta(
            session, gym_id, staff_id, staff_rol, staff_nombre, idempotency_key, req.pago, membresia_id=nueva_m["id"]
        )

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CAMBIO_DE_PLAN",
            entidad="membresias",
            entidad_id=nueva_m["id"],
            detalle={
                "membresia_anterior_id": str(membresia_id),
                "nueva_membresia_id": str(nueva_m["id"]),
                "nuevo_plan_nombre": new_plan["nombre"],
                "motivo": req.motivo or "CAMBIO_DE_PLAN",
                "fecha_inicio": str(f_inicio_nueva),
                "fecha_vencimiento": str(nueva_venc),
                "pago_id": str(pago.id),
                "monto": float(pago.monto),
            }
        )

        calc = MembresiaDomainService.evaluar_estado_puro(
            hoy=hoy,
            activo_deportista=curr["deportista_activo"],
            tiene_membresia=True,
            fecha_vencimiento=nueva_venc,
            dias_gracia_mora=gracia,
            dias_umbral_por_vencer=umbral,
            membresia_id=nueva_m["id"],
            plan_nombre=new_plan["nombre"]
        )

        return MembresiaResponse(
            **nueva_m,
            plan_nombre=new_plan["nombre"],
            estado_calculado=calc.estado,
            dias_restantes_o_vencido=calc.dias_restantes_o_vencido,
            congelamiento_activo=False,
            pago=pago,
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

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
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

        # 1. Validar membresía y calcular estado de negocio (GW-RF-26 CA1)
        q_m = text("""
            SELECT m.id, m.fecha_vencimiento, m.cancelada, m.plan_id, p.nombre as plan_nombre,
                   d.activo as deportista_activo
            FROM platform.membresias m
            JOIN platform.planes p ON p.id = m.plan_id
            JOIN platform.deportistas d ON d.id = m.deportista_id
            WHERE m.id = :id AND m.gimnasio_id = :gym_id
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

        # Evaluar estado puro de negocio (CA1: solo activo o por_vencer)
        gracia, umbral = await cls._obtener_config_tenant(session, gym_id)
        calc = MembresiaDomainService.evaluar_estado_puro(
            hoy=hoy,
            activo_deportista=m["deportista_activo"],
            tiene_membresia=True,
            ultima_cancelada=m["cancelada"],
            fecha_vencimiento=m["fecha_vencimiento"],
            congelamiento_activo=False,
            dias_gracia_mora=gracia,
            dias_umbral_por_vencer=umbral,
            membresia_id=m["id"],
            plan_nombre=m["plan_nombre"]
        )
        if calc.estado not in ("activo", "por_vencer"):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "codigo": "MEMBRESIA_NO_CONGELABLE",
                    "mensaje": f"Solo se puede congelar una membresía en estado 'activo' o 'por_vencer' (estado actual: '{calc.estado}')"
                }
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

        # 3. Validar mínimo de días y tope acumulado configurable (GW-RF-26 CA3)
        q_tenant = text("""
            SELECT COALESCE(minimo_dias_congelamiento, 1) as minimo_dias,
                   COALESCE(tope_dias_congelamiento, 30) as tope_dias
            FROM platform.tenant WHERE id = :gym_id
        """)
        res_t = await session.execute(q_tenant, {"gym_id": gym_id})
        t_row = res_t.mappings().first()
        minimo_dias = t_row["minimo_dias"] if t_row else 1
        tope_dias = t_row["tope_dias"] if t_row else 30

        dias_a_congelar: Optional[int] = None
        if req.dias is not None:
            dias_a_congelar = req.dias
        elif req.fecha_fin is not None:
            dias_a_congelar = (req.fecha_fin - hoy).days

        if dias_a_congelar is not None and dias_a_congelar < minimo_dias:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "codigo": "CONGELAMIENTO_MENOR_MINIMO",
                    "mensaje": f"El período a congelar ({dias_a_congelar} días) es menor al mínimo permitido ({minimo_dias} días)",
                    "detalles": {"minimo_dias": minimo_dias, "dias_solicitados": dias_a_congelar}
                }
            )

        q_prev = text("""
            SELECT COALESCE(SUM(dias), 0) FROM platform.congelamientos
            WHERE gimnasio_id = :gym_id AND membresia_id = :memb_id AND fecha_fin IS NOT NULL
        """)
        res_prev = await session.execute(q_prev, {"gym_id": gym_id, "memb_id": membresia_id})
        dias_consumidos = res_prev.scalar() or 0

        dias_validar = dias_a_congelar if dias_a_congelar is not None else 1
        if dias_consumidos + dias_validar > tope_dias:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "codigo": "TOPE_CONGELAMIENTO_ALCANZADO",
                    "mensaje": f"Se ha alcanzado o superaría el tope máximo de {tope_dias} días de congelamiento permitidos para esta membresía",
                    "detalles": {"tope_dias": tope_dias, "dias_consumidos": dias_consumidos}
                }
            )

        # 4. Insertar congelamiento abierto (fecha_fin IS NULL mientras esté vigente)
        q_ins = text("""
            INSERT INTO platform.congelamientos (
                gimnasio_id, membresia_id, fecha_inicio, fecha_fin, dias, registrado_por
            ) VALUES (
                :gym_id, :memb_id, :hoy, NULL, :dias, :staff_id
            ) RETURNING id, fecha_inicio, fecha_fin, dias, created_at
        """)
        try:
            res_ins = await session.execute(q_ins, {
                "gym_id": gym_id,
                "memb_id": membresia_id,
                "hoy": hoy,
                "dias": dias_a_congelar,
                "staff_id": staff_id,
            })
            cong = res_ins.mappings().one()
        except IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "MEMBRESIA_YA_CONGELADA", "mensaje": "Conflicto concurrente: la membresía ya fue congelada"}
            )

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CONGELAR_MEMBRESIA",
            entidad="congelamientos",
            entidad_id=cong["id"],
            detalle={
                "membresia_id": str(membresia_id),
                "fecha_inicio": str(hoy),
                "dias_programados": dias_a_congelar,
                "motivo": req.motivo
            }
        )

        return CongelamientoItemResponse(
            id=cong["id"],
            fecha_inicio=cong["fecha_inicio"],
            fecha_fin=None,
            dias=cong["dias"],
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
            SELECT id, fecha_inicio, dias FROM platform.congelamientos
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
        dias_efectivos = min(dias_reales, cong["dias"]) if cong.get("dias") else dias_reales
        dias_disponibles = max(0, tope - dias_previos)
        dias_a_extender = min(dias_efectivos, dias_disponibles)

        # 3. Cerrar congelamiento y extender vigencia por días efectivos (GW-RF-26 CA4)
        q_close = text("""
            UPDATE platform.congelamientos
            SET fecha_fin = :hoy, dias = :dias
            WHERE id = :id
            RETURNING id, fecha_inicio, fecha_fin, dias, created_at
        """)
        res_close = await session.execute(q_close, {"hoy": hoy, "dias": dias_a_extender, "id": cong["id"]})
        closed_cong = res_close.mappings().one()

        if dias_a_extender > 0:
            q_ext = text("""
                UPDATE platform.membresias
                SET fecha_vencimiento = fecha_vencimiento + CAST(:dias AS integer), updated_at = now()
                WHERE id = :id
            """)
            await session.execute(q_ext, {"dias": dias_a_extender, "id": membresia_id})

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
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
                   m.plan_id, p.nombre as plan_nombre, m.fecha_inicio, m.fecha_vencimiento, m.cancelada,
                   m.plan_precio_vendido, m.plan_duracion_dias_vendida
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
        gracia, umbral = await cls._obtener_config_tenant(session, gym_id)

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
                   m.plan_precio_vendido, m.plan_duracion_dias_vendida,
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
        gracia, umbral = await cls._obtener_config_tenant(session, gym_id)
        calc = MembresiaDomainService.evaluar_estado_puro(
            hoy=hoy,
            activo_deportista=m["deportista_activo"],
            tiene_membresia=not m["cancelada"],
            ultima_cancelada=m["cancelada"],
            fecha_vencimiento=m["fecha_vencimiento"],
            congelamiento_activo=bool(congelamiento_activo_id),
            congelamiento_id=congelamiento_activo_id,
            dias_gracia_mora=gracia,
            dias_umbral_por_vencer=umbral,
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
            congelamiento_activo=calc.congelamiento_activo,
            congelamiento_id=calc.congelamiento_id,
            plan_precio_vendido=m["plan_precio_vendido"],
            plan_duracion_dias_vendida=m["plan_duracion_dias_vendida"],
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
                   m.fecha_inicio, m.fecha_vencimiento, m.cancelada, m.created_at, m.updated_at,
                   m.plan_precio_vendido, m.plan_duracion_dias_vendida
            FROM platform.membresias m
            JOIN platform.planes p ON p.id = m.plan_id
            WHERE m.gimnasio_id = :gym_id AND m.deportista_id = :dep_id
            ORDER BY m.fecha_vencimiento DESC, m.created_at DESC
        """)
        res = await session.execute(q, {"gym_id": gym_id, "dep_id": deportista_id})
        raw_items = [dict(r) for r in res.mappings().all()]

        gracia, umbral = await cls._obtener_config_tenant(session, gym_id)

        enriquecidos = await MembresiaDomainService.enriquecer_membresias_batch(
            session=session,
            gym_id=gym_id,
            items=raw_items,
            dias_gracia_mora=gracia,
            dias_umbral_por_vencer=umbral
        )

        return [MembresiaResponse(**item) for item in enriquecidos]

    # =========================================================================
    # 4. PLANES GRUPALES Y PAQUETES (GW-RF-52, Contrato 1.3)
    # =========================================================================

    @classmethod
    async def crear_paquete(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        req: CrearPaqueteRequest,
        staff_rol: str = "",
        idempotency_key: str = "",
    ) -> CrearPaqueteResponse:
        """Vende un plan grupal: crea el paquete, sus N membresías y un solo cobro, en la misma transacción."""
        hoy = today_local()

        # 1. Validar que no haya beneficiarios duplicados en la petición (Contrato 1.3: 409 BENEFICIARIO_DUPLICADO)
        if len(req.beneficiarios) != len(set(req.beneficiarios)):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "BENEFICIARIO_DUPLICADO", "mensaje": "La lista de beneficiarios contiene deportistas duplicados"}
            )

        # 2. Validar que el titular esté incluido en los beneficiarios (Contrato 1.3: 422 TITULAR_NO_ES_BENEFICIARIO)
        if req.titular_id not in req.beneficiarios:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"codigo": "TITULAR_NO_ES_BENEFICIARIO", "mensaje": "El titular debe ser uno de los beneficiarios del paquete"}
            )

        # 3. Consultar y validar plan tarifario
        q_plan = text("""
            SELECT id, nombre, precio, duracion_dias, tipo, cupo_personas, activo
            FROM platform.planes
            WHERE id = :plan_id AND gimnasio_id = :gym_id
        """)
        res_plan = await session.execute(q_plan, {"plan_id": req.plan_id, "gym_id": gym_id})
        plan = res_plan.mappings().first()
        if not plan:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PLAN_NO_ENCONTRADO", "mensaje": "El plan tarifario especificado no existe"}
            )
        if not plan["activo"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "PLAN_INACTIVO", "mensaje": "El plan tarifario seleccionado se encuentra inactivo"}
            )

        # 4. Validar cantidad exacta de beneficiarios (CA1, Contrato 1.3: 422 BENEFICIARIOS_INCOMPLETOS)
        cupo_requerido = plan["cupo_personas"]
        cupo_recibido = len(req.beneficiarios)
        if cupo_recibido != cupo_requerido:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "codigo": "BENEFICIARIOS_INCOMPLETOS",
                    "mensaje": f"El plan requiere exactamente {cupo_requerido} beneficiarios, pero se recibieron {cupo_recibido}",
                    "detalles": {"requeridos": cupo_requerido, "recibidos": cupo_recibido}
                }
            )

        # 5. Validar deportistas beneficiarios y mayoría de edad del titular (CA2, Contrato 1.3: 422 TITULAR_MENOR_DE_EDAD)
        q_deps = text("""
            SELECT id, nombre, fecha_nacimiento, activo
            FROM platform.deportistas
            WHERE gimnasio_id = :gym_id AND id = ANY(:ids) AND deleted_at IS NULL
            ORDER BY id
            FOR UPDATE
        """)
        res_deps = await session.execute(q_deps, {"gym_id": gym_id, "ids": req.beneficiarios})
        deps_map = {r["id"]: r for r in res_deps.mappings()}

        # Reintento de la misma venta (con los beneficiarios bloqueados): devuelve la original.
        previo = await cls._venta_previa(session, gym_id, idempotency_key)
        if previo:
            if previo.paquete_id is None:
                raise cls._clave_en_uso()
            detalle = await cls.obtener_paquete(session, gym_id, previo.paquete_id)
            return CrearPaqueteResponse(paquete_id=detalle.id, membresias=detalle.membresias, pago=previo)

        for b_id in req.beneficiarios:
            if b_id not in deps_map:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": f"El deportista con ID {b_id} no existe o no pertenece a este gimnasio"}
                )
            if not deps_map[b_id]["activo"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "DEPORTISTA_INACTIVO", "mensaje": f"El beneficiario '{deps_map[b_id]['nombre']}' se encuentra inactivo"}
                )

        titular = deps_map[req.titular_id]
        fn_titular = titular["fecha_nacimiento"]
        if not fn_titular:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"codigo": "TITULAR_MENOR_DE_EDAD", "mensaje": "El titular debe ser mayor de 18 años (fecha de nacimiento requerida)"}
            )
        edad_titular = (hoy.year - fn_titular.year) - ((hoy.month, hoy.day) < (fn_titular.month, fn_titular.day))
        if edad_titular < 18:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"codigo": "TITULAR_MENOR_DE_EDAD", "mensaje": "El titular del paquete debe ser mayor de 18 años"}
            )

        # 6. Crear el registro del paquete en platform.paquetes
        q_paq = text("""
            INSERT INTO platform.paquetes (
                gimnasio_id, plan_id, titular_id, created_at, updated_at
            ) VALUES (
                :gym_id, :plan_id, :titular_id, now(), now()
            ) RETURNING id
        """)
        res_paq = await session.execute(q_paq, {
            "gym_id": gym_id,
            "plan_id": req.plan_id,
            "titular_id": req.titular_id
        })
        paquete_id = res_paq.scalar_one()

        # 7. Asignación de precio dividido en enteros con sobrante al titular (GW-RF-52)
        plan_precio_total = int(plan["precio"])
        n = len(req.beneficiarios)
        precio_base_indiv = Decimal(plan_precio_total // n)
        sobrante = Decimal(plan_precio_total % n)

        # 8. Creación de N membresías individuales ligadas al paquete (atómico en la misma transacción, CA3)
        fecha_inicio_base = req.fecha_inicio or hoy
        duracion_dias = plan["duracion_dias"]
        membresias_creadas = []

        for b_id in req.beneficiarios:
            dep_info = deps_map[b_id]
            # Beneficiario con membresía vigente: Su membresía del paquete empieza cuando vence la actual (GW-RF-52)
            q_vigente = text("""
                SELECT fecha_vencimiento
                FROM platform.membresias
                WHERE gimnasio_id = :gym_id AND deportista_id = :b_id AND cancelada = false
                  AND fecha_vencimiento >= :hoy
                ORDER BY fecha_vencimiento DESC
                LIMIT 1
            """)
            res_vig = await session.execute(q_vigente, {"gym_id": gym_id, "b_id": b_id, "hoy": hoy})
            row_vig = res_vig.mappings().first()

            if row_vig and row_vig["fecha_vencimiento"] >= fecha_inicio_base:
                f_inicio = row_vig["fecha_vencimiento"] + timedelta(days=1)
            else:
                f_inicio = fecha_inicio_base

            f_venc = f_inicio + timedelta(days=duracion_dias)

            # Si es el titular, recibe el sobrante
            p_asignado = (precio_base_indiv + sobrante) if b_id == req.titular_id else precio_base_indiv

            q_ins_m = text("""
                INSERT INTO platform.membresias (
                    gimnasio_id, deportista_id, plan_id, paquete_id, fecha_inicio, fecha_vencimiento,
                    cancelada, plan_precio_vendido, plan_duracion_dias_vendida, precio_asignado,
                    created_at, updated_at
                ) VALUES (
                    :gym_id, :dep_id, :plan_id, :paq_id, :f_ini, :f_venc,
                    false, :precio_vendido, :duracion_vendida, :precio_asignado,
                    now(), now()
                ) RETURNING id
            """)
            res_m = await session.execute(q_ins_m, {
                "gym_id": gym_id,
                "dep_id": b_id,
                "plan_id": req.plan_id,
                "paq_id": paquete_id,
                "f_ini": f_inicio,
                "f_venc": f_venc,
                "precio_vendido": p_asignado,
                "duracion_vendida": duracion_dias,
                "precio_asignado": p_asignado
            })
            m_id = res_m.scalar_one()

            membresias_creadas.append(PaqueteMembresiaItemDto(
                id=m_id,
                deportista_id=b_id,
                deportista_nombre=dep_info["nombre"],
                fecha_inicio=f_inicio,
                fecha_vencimiento=f_venc,
                precio_asignado=p_asignado
            ))

        # 9. Un solo cobro por todo el paquete (venta: no suma días)
        pago = await cls._cobrar_venta(
            session, gym_id, staff_id, staff_rol, staff_nombre, idempotency_key, req.pago, paquete_id=paquete_id
        )

        # 10. Auditoría inmutable de creación de paquete
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CREAR_PAQUETE_MEMBRESIAS",
            entidad="paquetes",
            entidad_id=str(paquete_id),
            detalle={
                "plan_id": str(req.plan_id),
                "plan_nombre": plan["nombre"],
                "titular_id": str(req.titular_id),
                "titular_nombre": titular["nombre"],
                "total_beneficiarios": n,
                "membresias_ids": [str(it.id) for it in membresias_creadas],
                "pago_id": str(pago.id),
                "monto": float(pago.monto),
            }
        )

        return CrearPaqueteResponse(
            paquete_id=paquete_id,
            membresias=membresias_creadas,
            pago=pago,
        )

    @classmethod
    async def obtener_paquete(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        paquete_id: UUID,
    ) -> DetallePaqueteResponse:
        q_paq = text("""
            SELECT pq.id, pq.titular_id, p.nombre as plan_nombre,
                   d.nombre as titular_nombre, d.telefono as titular_telefono
            FROM platform.paquetes pq
            JOIN platform.planes p ON p.id = pq.plan_id
            JOIN platform.deportistas d ON d.id = pq.titular_id
            WHERE pq.id = :paq_id AND pq.gimnasio_id = :gym_id
        """)
        res_paq = await session.execute(q_paq, {"paq_id": paquete_id, "gym_id": gym_id})
        paq = res_paq.mappings().first()
        if not paq:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PAQUETE_NO_ENCONTRADO", "mensaje": "Paquete de membresías no encontrado"}
            )

        q_membs = text("""
            SELECT m.id, m.deportista_id, d.nombre as deportista_nombre,
                   m.fecha_inicio, m.fecha_vencimiento, m.precio_asignado
            FROM platform.membresias m
            JOIN platform.deportistas d ON d.id = m.deportista_id
            WHERE m.paquete_id = :paq_id AND m.gimnasio_id = :gym_id
            ORDER BY m.created_at ASC
        """)
        res_membs = await session.execute(q_membs, {"paq_id": paquete_id, "gym_id": gym_id})
        membs = [
            PaqueteMembresiaItemDto(
                id=r["id"],
                deportista_id=r["deportista_id"],
                deportista_nombre=r["deportista_nombre"],
                fecha_inicio=r["fecha_inicio"],
                fecha_vencimiento=r["fecha_vencimiento"],
                precio_asignado=Decimal(str(r["precio_asignado"] or 0))
            ) for r in res_membs.mappings()
        ]

        return DetallePaqueteResponse(
            id=paq["id"],
            plan_nombre=paq["plan_nombre"],
            titular=TitularResumenDto(
                id=paq["titular_id"],
                nombre=paq["titular_nombre"],
                telefono=paq["titular_telefono"]
            ),
            membresias=membs
        )
