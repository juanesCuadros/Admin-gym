import json
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.holidays_colombia import es_festivo_colombia
from app.core.timezone import LOCAL_TZ, get_local_day_range_utc, now_local, now_utc
from app.modules.clases.schemas import (
    AsistenciaResponse,
    CalificacionResponse,
    ClaseResponse,
    ClasesPaginadasResponse,
    CrearCalificacionRequest,
    CrearReservaRequest,
    EditarClaseRequest,
    ProgramarClaseRequest,
    RegistrarAsistenciaRequest,
    ReservaResponse,
    ResumenAsistenciaClaseResponse,
    ResumenCalificacionesResponse,
)
from app.modules.membresias.domain import MembresiaDomainService


class ClasesService:

    @classmethod
    async def programar_clase(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        req: ProgramarClaseRequest,
    ) -> ClaseResponse:
        """
        Programa una clase única o genera una serie de clases recurrentes (RF-32).
        Si omitir_festivos es True, omite automáticamente las fechas que coincidan con festivos colombianos.
        """
        # 1. Validar profesor interno si fue especificado
        if req.entrenador_id:
            q_ent = text("SELECT id, nombre FROM platform.staff WHERE id = :id AND gimnasio_id = :gym_id AND activo = true")
            res_ent = await session.execute(q_ent, {"id": req.entrenador_id, "gym_id": gym_id})
            if not res_ent.mappings().first():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "ENTRENADOR_NO_ENCONTRADO", "mensaje": "Entrenador no encontrado o inactivo"}
                )

        fechas_a_programar: List[datetime] = []

        if not req.recurrente:
            # Clase única
            fechas_a_programar.append(req.fecha_hora)
            regla_json = None
        else:
            # Serie recurrente: calcular fechas proyectadas en la ventana de semanas
            regla_dict = {
                "dias_semana": req.dias_semana,
                "duracion_minutos": req.duracion_minutos,
                "semanas_a_proyectar": req.semanas_a_proyectar,
                "omitir_festivos": req.omitir_festivos,
                "hora_base": req.fecha_hora.strftime("%H:%M:%S"),
            }
            regla_json = json.dumps(regla_dict)

            # Extraer componentes locales de fecha y hora
            dt_local_base = req.fecha_hora.astimezone(LOCAL_TZ)
            time_base = dt_local_base.time()
            fecha_inicio_local = dt_local_base.date()

            # Iterar día a día durante las semanas solicitadas
            total_dias = req.semanas_a_proyectar * 7
            for d_offset in range(total_dias):
                curr_date = fecha_inicio_local + timedelta(days=d_offset)
                # weekday(): 0 es Lunes ... 6 es Domingo
                if curr_date.weekday() in req.dias_semana:
                    # Si omitir_festivos está activo, verificar si es festivo legal en Colombia
                    if req.omitir_festivos and es_festivo_colombia(curr_date):
                        continue

                    # Combinar fecha local con hora base y convertir a UTC
                    dt_instancia_local = datetime.combine(curr_date, time_base, tzinfo=LOCAL_TZ)
                    fechas_a_programar.append(dt_instancia_local.astimezone(timezone.utc))

        if not fechas_a_programar:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "SIN_FECHAS_VALIDAS", "mensaje": "No se encontraron fechas válidas para programar la clase (todas coincidieron con festivos omitidos o rango inválido)"}
            )

        # 2. Insertar instancias en platform.clases
        q_ins = text("""
            INSERT INTO platform.clases (
                gimnasio_id, nombre, tipo, entrenador_id, profesor_externo,
                cupo, fecha_hora, recurrente, regla_recurrencia, omitir_festivos, estado
            ) VALUES (
                :gym_id, :nombre, :tipo, :entrenador_id, :profesor_externo,
                :cupo, :fecha_hora, :recurrente, :regla_recurrencia, :omitir_festivos, 'programada'
            ) RETURNING id
        """)

        primer_id = None
        for fh in fechas_a_programar:
            res_ins = await session.execute(q_ins, {
                "gym_id": gym_id,
                "nombre": req.nombre.strip(),
                "tipo": req.tipo.strip() if req.tipo else None,
                "entrenador_id": req.entrenador_id,
                "profesor_externo": req.profesor_externo.strip() if req.profesor_externo else None,
                "cupo": req.cupo,
                "fecha_hora": fh,
                "recurrente": req.recurrente,
                "regla_recurrencia": regla_json,
                "omitir_festivos": req.omitir_festivos,
            })
            inserted_id = res_ins.scalar_one()
            if primer_id is None:
                primer_id = inserted_id

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="PROGRAMAR_CLASE" if not req.recurrente else "PROGRAMAR_CLASE_RECURRENTE",
            entidad="clases",
            entidad_id=primer_id,
            detalle={
                "nombre": req.nombre,
                "total_instancias_creadas": len(fechas_a_programar),
                "recurrente": req.recurrente,
                "omitir_festivos": req.omitir_festivos,
            }
        )

        return await cls.obtener_clase(session, gym_id, primer_id)

    @classmethod
    async def listar_clases(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        desde: Optional[datetime] = None,
        hasta: Optional[datetime] = None,
        entrenador_id: Optional[UUID] = None,
        tipo: Optional[str] = None,
        estado: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> ClasesPaginadasResponse:
        """Lista las clases programadas con conteo de reservas y cupos disponibles."""
        clauses = ["c.gimnasio_id = :gym_id"]
        params: Dict[str, Any] = {"gym_id": gym_id, "skip": skip, "limit": limit}

        if desde:
            clauses.append("c.fecha_hora >= :desde")
            params["desde"] = desde
        if hasta:
            clauses.append("c.fecha_hora <= :hasta")
            params["hasta"] = hasta
        if entrenador_id:
            clauses.append("c.entrenador_id = :entrenador_id")
            params["entrenador_id"] = entrenador_id
        if tipo:
            clauses.append("c.tipo ILIKE :tipo")
            params["tipo"] = f"%{tipo.strip()}%"
        if estado:
            clauses.append("c.estado = :estado")
            params["estado"] = estado

        where_sql = " AND ".join(clauses)

        # Conteo total
        q_count = text(f"SELECT COUNT(*) FROM platform.clases c WHERE {where_sql}")
        res_count = await session.execute(q_count, params)
        total = res_count.scalar_one()

        # Consulta con agregación de reservas y asistencias
        q_list = text(f"""
            SELECT c.id, c.gimnasio_id, c.nombre, c.tipo, c.entrenador_id,
                   s.nombre as entrenador_nombre, c.profesor_externo,
                   c.cupo, c.fecha_hora, c.recurrente, c.regla_recurrencia,
                   c.omitir_festivos, c.estado, c.created_at,
                   COUNT(r.id) FILTER (WHERE r.estado <> 'cancelada') as reservas_totales,
                   GREATEST(0, c.cupo - COUNT(r.id) FILTER (WHERE r.estado <> 'cancelada')) as cupos_disponibles,
                   COUNT(a.id) as asistencias_totales
            FROM platform.clases c
            LEFT JOIN platform.staff s ON s.id = c.entrenador_id
            LEFT JOIN platform.reservas_clase r ON r.clase_id = c.id
            LEFT JOIN platform.asistencia_clase a ON a.clase_id = c.id
            WHERE {where_sql}
            GROUP BY c.id, s.nombre
            ORDER BY c.fecha_hora ASC
            OFFSET :skip LIMIT :limit
        """)
        res_list = await session.execute(q_list, params)

        items = [ClaseResponse(**row) for row in res_list.mappings().all()]
        return ClasesPaginadasResponse(items=items, total=total, skip=skip, limit=limit)

    @classmethod
    async def obtener_clase(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        clase_id: UUID,
    ) -> ClaseResponse:
        """Obtiene el detalle de una clase con disponibilidad de cupos."""
        q = text("""
            SELECT c.id, c.gimnasio_id, c.nombre, c.tipo, c.entrenador_id,
                   s.nombre as entrenador_nombre, c.profesor_externo,
                   c.cupo, c.fecha_hora, c.recurrente, c.regla_recurrencia,
                   c.omitir_festivos, c.estado, c.created_at,
                   COUNT(r.id) FILTER (WHERE r.estado <> 'cancelada') as reservas_totales,
                   GREATEST(0, c.cupo - COUNT(r.id) FILTER (WHERE r.estado <> 'cancelada')) as cupos_disponibles,
                   COUNT(a.id) as asistencias_totales
            FROM platform.clases c
            LEFT JOIN platform.staff s ON s.id = c.entrenador_id
            LEFT JOIN platform.reservas_clase r ON r.clase_id = c.id
            LEFT JOIN platform.asistencia_clase a ON a.clase_id = c.id
            WHERE c.id = :id AND c.gimnasio_id = :gym_id
            GROUP BY c.id, s.nombre
        """)
        res = await session.execute(q, {"id": clase_id, "gym_id": gym_id})
        row = res.mappings().first()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "CLASE_NO_ENCONTRADA", "mensaje": "Clase no encontrada"}
            )
        return ClaseResponse(**row)

    @classmethod
    async def editar_clase(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        clase_id: UUID,
        req: EditarClaseRequest,
    ) -> ClaseResponse:
        """Modifica datos de una clase programada (profesor, cupo, fecha_hora)."""
        clase = await cls.obtener_clase(session, gym_id, clase_id)
        if clase.estado != "programada":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "CLASE_NO_EDITABLE", "mensaje": f"No se puede editar una clase con estado '{clase.estado}'"}
            )

        # Si se reduce el cupo, verificar que no quede por debajo de las reservas activas
        if req.cupo is not None and req.cupo < clase.reservas_totales:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "codigo": "CUPO_MENOR_A_RESERVAS",
                    "mensaje": f"El nuevo cupo ({req.cupo}) no puede ser menor a las reservas activas ({clase.reservas_totales})"
                }
            )

        # Validar profesor si cambia
        if req.entrenador_id is not None:
            q_ent = text("SELECT id FROM platform.staff WHERE id = :id AND gimnasio_id = :gym_id AND activo = true")
            res_ent = await session.execute(q_ent, {"id": req.entrenador_id, "gym_id": gym_id})
            if not res_ent.mappings().first():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "ENTRENADOR_NO_ENCONTRADO", "mensaje": "Entrenador no encontrado o inactivo"}
                )

        q_upd = text("""
            UPDATE platform.clases
            SET nombre = COALESCE(:nombre, nombre),
                tipo = COALESCE(:tipo, tipo),
                entrenador_id = CASE WHEN :cambio_entrenador THEN :entrenador_id ELSE entrenador_id END,
                profesor_externo = CASE WHEN :cambio_externo THEN :profesor_externo ELSE profesor_externo END,
                cupo = COALESCE(:cupo, cupo),
                fecha_hora = COALESCE(:fecha_hora, fecha_hora)
            WHERE id = :id AND gimnasio_id = :gym_id
        """)
        await session.execute(q_upd, {
            "id": clase_id,
            "gym_id": gym_id,
            "nombre": req.nombre.strip() if req.nombre else None,
            "tipo": req.tipo.strip() if req.tipo else None,
            "cambio_entrenador": req.entrenador_id is not None,
            "entrenador_id": req.entrenador_id,
            "cambio_externo": req.profesor_externo is not None,
            "profesor_externo": req.profesor_externo.strip() if req.profesor_externo else None,
            "cupo": req.cupo,
            "fecha_hora": req.fecha_hora,
        })

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="EDITAR_CLASE",
            entidad="clases",
            entidad_id=clase_id,
            detalle={"campos_modificados": req.model_dump(exclude_unset=True)}
        )

        return await cls.obtener_clase(session, gym_id, clase_id)

    @classmethod
    async def cancelar_clase(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        clase_id: UUID,
    ) -> ClaseResponse:
        """
        Cancela una clase programada (RF-32) y cancela automáticamente todas sus reservas vigentes.
        
        DOCUMENTACIÓN EXPLÍCITA DE VENTA_ITEM_ID:
        Al actualizar las reservas a estado = 'cancelada', cualquier pase de clase pagado (venta_item_id)
        queda AUTOMÁTICAMENTE LIBERADO y disponible para que el deportista lo reutilice en otra clase,
        dado que el control de doble uso únicamente cuenta reservas donde estado <> 'cancelada'.
        Esta liberación intencional compensa al deportista cuando la clase es cancelada por el gimnasio.
        """
        clase = await cls.obtener_clase(session, gym_id, clase_id)
        if clase.estado == "cancelada":
            return clase

        # 1. Marcar clase como cancelada
        q_clase = text("UPDATE platform.clases SET estado = 'cancelada' WHERE id = :id AND gimnasio_id = :gym_id")
        await session.execute(q_clase, {"id": clase_id, "gym_id": gym_id})

        # 2. Cancelar reservas vigentes (libera pases venta_item_id)
        q_res = text("""
            UPDATE platform.reservas_clase
            SET estado = 'cancelada'
            WHERE clase_id = :clase_id AND gimnasio_id = :gym_id AND estado = 'reservada'
        """)
        await session.execute(q_res, {"clase_id": clase_id, "gym_id": gym_id})

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CANCELAR_CLASE",
            entidad="clases",
            entidad_id=clase_id,
            detalle={"reservas_canceladas": clase.reservas_totales}
        )

        return await cls.obtener_clase(session, gym_id, clase_id)

    @classmethod
    async def crear_reserva(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        clase_id: UUID,
        req: CrearReservaRequest,
    ) -> ReservaResponse:
        """
        Crea una reserva de cupo para un deportista en una clase (RF-33).
        - Exige que la clase esté programada y no haya iniciado aún (fecha_hora > now()).
        - Verifica que haya cupo disponible (FOR UPDATE).
        - Verifica unicidad de reserva por deportista.
        - Evalúa estado de membresía:
          * Activa/Por Vencer: puede reservar gratis (pase_pagado = false, venta_item_id = None).
          * Sin membresía / Vencido / Congelado / Mora: EXIGE venta_item_id de tipo 'pase_clase'
            pagado en caja y no reutilizado previamente.
        """
        # 1. Bloquear y validar la clase
        q_clase = text("""
            SELECT id, nombre, cupo, fecha_hora, estado
            FROM platform.clases
            WHERE id = :id AND gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res_c = await session.execute(q_clase, {"id": clase_id, "gym_id": gym_id})
        clase = res_c.mappings().first()
        if not clase:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "CLASE_NO_ENCONTRADA", "mensaje": "Clase no encontrada"}
            )
        if clase["estado"] != "programada":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "CLASE_NO_DISPONIBLE", "mensaje": f"No se puede reservar en una clase con estado '{clase['estado']}'"}
            )

        # Regla temporal explícita: No se permite reservar clases que ya hayan iniciado
        if clase["fecha_hora"] <= now_utc():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "CLASE_INICIADA_O_FINALIZADA", "mensaje": "No se pueden reservar clases que ya han iniciado o finalizado"}
            )

        # 2. Validar cupos disponibles
        q_count = text("""
            SELECT COUNT(*) FROM platform.reservas_clase
            WHERE clase_id = :clase_id AND estado <> 'cancelada'
        """)
        res_count = await session.execute(q_count, {"clase_id": clase_id})
        reservas_actuales = res_count.scalar_one()
        if reservas_actuales >= clase["cupo"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "CUPO_AGOTADO", "mensaje": "La clase no cuenta con cupos disponibles"}
            )

        # 3. Validar deportista
        q_dep = text("SELECT id, nombre, documento, activo FROM platform.deportistas WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL")
        res_dep = await session.execute(q_dep, {"id": req.deportista_id, "gym_id": gym_id})
        dep = res_dep.mappings().first()
        if not dep:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado"}
            )

        # 4. Validar que no tenga reserva activa en esta clase
        q_dup = text("""
            SELECT id FROM platform.reservas_clase
            WHERE clase_id = :clase_id AND deportista_id = :dep_id AND estado <> 'cancelada'
        """)
        res_dup = await session.execute(q_dup, {"clase_id": clase_id, "dep_id": req.deportista_id})
        if res_dup.mappings().first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "RESERVA_YA_EXISTE", "mensaje": "El deportista ya cuenta con una reserva activa en esta clase"}
            )

        # 5. Evaluar estado de membresía canónico
        # Obtener configuración del tenant
        q_tenant = text("SELECT dias_gracia_mora, dias_umbral_por_vencer FROM platform.tenant WHERE id = :gym_id")
        res_t = await session.execute(q_tenant, {"gym_id": gym_id})
        cfg_t = res_t.mappings().first()
        gracia = cfg_t["dias_gracia_mora"] if cfg_t else 3
        umbral = cfg_t["dias_umbral_por_vencer"] if cfg_t else 5

        # Obtener membresía vigente si existe
        q_memb = text("""
            SELECT m.id, m.fecha_vencimiento, m.cancelada,
                   EXISTS(SELECT 1 FROM platform.congelamientos c WHERE c.membresia_id = m.id AND c.fecha_fin IS NULL) as congelada
            FROM platform.membresias m
            WHERE m.gimnasio_id = :gym_id AND m.deportista_id = :dep_id AND m.cancelada = false
            ORDER BY m.fecha_vencimiento DESC, m.created_at DESC
            LIMIT 1
        """)
        res_m = await session.execute(q_memb, {"gym_id": gym_id, "dep_id": req.deportista_id})
        memb = res_m.mappings().first()

        estado_memb = "sin_membresia"
        if memb:
            calc = MembresiaDomainService.evaluar_estado_puro(
                hoy=now_local().date(),
                activo_deportista=dep["activo"],
                tiene_membresia=True,
                ultima_cancelada=memb["cancelada"],
                fecha_vencimiento=memb["fecha_vencimiento"],
                congelamiento_activo=memb["congelada"],
                dias_gracia_mora=gracia,
                dias_umbral_por_vencer=umbral,
            )
            estado_memb = calc.estado

        pase_pagado = False
        venta_item_id = None

        # 6. Regla de negocio RF-33: Sólo membresía activa (activo o por_vencer) reserva sin costo
        if estado_memb in ("activo", "por_vencer"):
            pase_pagado = False
            venta_item_id = None
        else:
            # Requiere pase de clase pagado en caja
            if not req.venta_item_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "codigo": "PASE_CLASE_REQUERIDO",
                        "mensaje": f"El deportista tiene estado '{estado_memb}' y requiere presentar un pase de clase pagado en Caja (RF-33)"
                    }
                )

            # Validar el pase de clase en platform.venta_items
            q_item = text("""
                SELECT vi.id, vi.tipo, v.anulada
                FROM platform.venta_items vi
                JOIN platform.ventas v ON v.id = vi.venta_id
                WHERE vi.id = :item_id AND vi.gimnasio_id = :gym_id
            """)
            res_item = await session.execute(q_item, {"item_id": req.venta_item_id, "gym_id": gym_id})
            item_row = res_item.mappings().first()
            if not item_row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "PASE_CLASE_NO_ENCONTRADO", "mensaje": "El ítem de venta especificado no existe"}
                )
            if item_row["anulada"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "VENTA_ANULADA", "mensaje": "La venta asociada a este pase de clase fue anulada"}
                )
            if item_row["tipo"] != "pase_clase":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "ITEM_NO_ES_PASE_CLASE", "mensaje": f"El ítem de venta es de tipo '{item_row['tipo']}', no 'pase_clase'"}
                )

            # Control de doble uso: el pase no puede estar activo en otra reserva
            q_used = text("""
                SELECT id FROM platform.reservas_clase
                WHERE venta_item_id = :v_id AND estado <> 'cancelada'
            """)
            res_used = await session.execute(q_used, {"v_id": req.venta_item_id})
            if res_used.mappings().first():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"codigo": "PASE_CLASE_YA_UTILIZADO", "mensaje": "Este pase de clase ya fue utilizado en otra reserva activa"}
                )

            pase_pagado = True
            venta_item_id = req.venta_item_id

        # 7. Insertar reserva
        q_ins_res = text("""
            INSERT INTO platform.reservas_clase (
                gimnasio_id, clase_id, deportista_id, estado, pase_pagado, venta_item_id
            ) VALUES (
                :gym_id, :clase_id, :dep_id, 'reservada', :pase_pagado, :venta_item_id
            ) RETURNING id, created_at
        """)
        res_ins_r = await session.execute(q_ins_res, {
            "gym_id": gym_id,
            "clase_id": clase_id,
            "dep_id": req.deportista_id,
            "pase_pagado": pase_pagado,
            "venta_item_id": venta_item_id,
        })
        res_row = res_ins_r.mappings().one()

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CREAR_RESERVA_CLASE",
            entidad="reservas_clase",
            entidad_id=res_row["id"],
            detalle={
                "clase_id": str(clase_id),
                "deportista_id": str(req.deportista_id),
                "pase_pagado": pase_pagado,
                "venta_item_id": str(venta_item_id) if venta_item_id else None,
            }
        )

        return ReservaResponse(
            id=res_row["id"],
            gimnasio_id=gym_id,
            clase_id=clase_id,
            clase_nombre=clase["nombre"],
            clase_fecha_hora=clase["fecha_hora"],
            deportista_id=req.deportista_id,
            deportista_nombre=dep["nombre"],
            deportista_documento=dep["documento"],
            estado="reservada",
            pase_pagado=pase_pagado,
            venta_item_id=venta_item_id,
            created_at=res_row["created_at"],
        )

    @classmethod
    async def listar_reservas_clase(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        clase_id: UUID,
    ) -> List[ReservaResponse]:
        """Lista todas las reservas vigentes e históricas de una clase."""
        await cls.obtener_clase(session, gym_id, clase_id)
        q = text("""
            SELECT r.id, r.gimnasio_id, r.clase_id, c.nombre as clase_nombre, c.fecha_hora as clase_fecha_hora,
                   r.deportista_id, d.nombre as deportista_nombre, d.documento as deportista_documento,
                   r.estado, r.pase_pagado, r.venta_item_id, r.created_at
            FROM platform.reservas_clase r
            JOIN platform.clases c ON c.id = r.clase_id
            JOIN platform.deportistas d ON d.id = r.deportista_id
            WHERE r.clase_id = :clase_id AND r.gimnasio_id = :gym_id
            ORDER BY r.created_at ASC
        """)
        res = await session.execute(q, {"clase_id": clase_id, "gym_id": gym_id})
        return [ReservaResponse(**row) for row in res.mappings().all()]

    @classmethod
    async def cancelar_reserva(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        clase_id: UUID,
        reserva_id: UUID,
    ) -> ReservaResponse:
        """
        Cancela la reserva de un deportista y libera el cupo.
        
        DOCUMENTACIÓN EXPLÍCITA DE VENTA_ITEM_ID:
        Al cancelar la reserva (estado = 'cancelada'), el filtro de doble uso
        WHERE venta_item_id = :id AND estado <> 'cancelada' deja de contabilizar esta reserva,
        liberando el pase pagado en caja para que el deportista pueda usarlo en otra clase.
        """
        q = text("""
            SELECT r.id, r.gimnasio_id, r.clase_id, c.nombre as clase_nombre, c.fecha_hora as clase_fecha_hora,
                   r.deportista_id, d.nombre as deportista_nombre, d.documento as deportista_documento,
                   r.estado, r.pase_pagado, r.venta_item_id, r.created_at
            FROM platform.reservas_clase r
            JOIN platform.clases c ON c.id = r.clase_id
            JOIN platform.deportistas d ON d.id = r.deportista_id
            WHERE r.id = :reserva_id AND r.clase_id = :clase_id AND r.gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res = await session.execute(q, {"reserva_id": reserva_id, "clase_id": clase_id, "gym_id": gym_id})
        r_map = res.mappings().first()
        if not r_map:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "RESERVA_NO_ENCONTRADA", "mensaje": "Reserva no encontrada"}
            )
        if r_map["estado"] == "cancelada":
            return ReservaResponse(**r_map)

        q_upd = text("""
            UPDATE platform.reservas_clase
            SET estado = 'cancelada'
            WHERE id = :id AND gimnasio_id = :gym_id
        """)
        await session.execute(q_upd, {"id": reserva_id, "gym_id": gym_id})

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CANCELAR_RESERVA_CLASE",
            entidad="reservas_clase",
            entidad_id=reserva_id,
            detalle={
                "clase_id": str(clase_id),
                "deportista_id": str(r_map["deportista_id"]),
                "pase_liberado": r_map["pase_pagado"],
            }
        )

        dict_res = dict(r_map)
        dict_res["estado"] = "cancelada"
        return ReservaResponse(**dict_res)

    @classmethod
    async def registrar_asistencia(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        clase_id: UUID,
        req: RegistrarAsistenciaRequest,
    ) -> AsistenciaResponse:
        """
        Registra la asistencia a clase de un deportista (RF-34).
        - Exige haber ingresado previamente al gimnasio (platform.checkins del mismo día).
        - Utiliza el helper canónico get_local_day_range_utc() para garantizar precisión de corte de día.
        - Actualiza la reserva a estado = 'asistio'.
        """
        # 1. Obtener datos de la clase
        clase = await cls.obtener_clase(session, gym_id, clase_id)
        if clase.estado == "cancelada":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "CLASE_CANCELADA", "mensaje": "No se puede registrar asistencia en una clase cancelada"}
            )

        # 2. Validar que el deportista tenga una reserva activa
        q_res = text("""
            SELECT id, estado FROM platform.reservas_clase
            WHERE clase_id = :clase_id AND deportista_id = :dep_id AND estado = 'reservada'
            FOR UPDATE
        """)
        res_r = await session.execute(q_res, {"clase_id": clase_id, "dep_id": req.deportista_id})
        reserva = res_r.mappings().first()
        if not reserva:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "RESERVA_NO_ENCONTRADA", "mensaje": "El deportista no cuenta con una reserva activa en esta clase"}
            )

        # 3. Validar check-in de torniquete del mismo día calendario y proximidad a la clase (RF-34)
        # Convertir la fecha_hora de la clase a fecha local en America/Bogota
        clase_date_local = clase.fecha_hora.astimezone(LOCAL_TZ).date()
        start_day_utc, end_day_utc = get_local_day_range_utc(clase_date_local)
        # Límite superior de proximidad: no posterior a fecha_hora + 2 horas, ni posterior al fin de día
        max_checkin_utc = min(end_day_utc, clase.fecha_hora + timedelta(hours=2))

        # Buscar check-in de ingreso exitoso en la ventana del día y proximidad
        q_checkin = text("""
            SELECT id, ts_utc, resultado
            FROM platform.checkins
            WHERE gimnasio_id = :gym_id
              AND deportista_id = :dep_id
              AND tipo = 'ingreso'
              AND resultado IN ('abrio', 'alerta_mora')
              AND ts_utc >= :start_day_utc
              AND ts_utc <= :max_checkin_utc
            ORDER BY ts_utc DESC
            LIMIT 1
        """)
        res_chk = await session.execute(q_checkin, {
            "gym_id": gym_id,
            "dep_id": req.deportista_id,
            "start_day_utc": start_day_utc,
            "max_checkin_utc": max_checkin_utc,
        })
        checkin_row = res_chk.mappings().first()
        if not checkin_row:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "codigo": "SIN_CHECKIN_PREVIO",
                    "mensaje": "El deportista no ha registrado ingreso al gimnasio el día de la clase (RF-34)"
                }
            )

        # 4. Insertar en platform.asistencia_clase
        q_asist = text("""
            INSERT INTO platform.asistencia_clase (
                gimnasio_id, clase_id, deportista_id, checkin_id, check_in
            ) VALUES (
                :gym_id, :clase_id, :dep_id, :checkin_id, now()
            ) RETURNING id, check_in, created_at
        """)
        try:
            res_asist = await session.execute(q_asist, {
                "gym_id": gym_id,
                "clase_id": clase_id,
                "dep_id": req.deportista_id,
                "checkin_id": checkin_row["id"],
            })
            asist_row = res_asist.mappings().one()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "ASISTENCIA_YA_REGISTRADA", "mensaje": "La asistencia del deportista a esta clase ya fue registrada"}
            ) from exc

        # 5. Actualizar reserva a 'asistio'
        q_upd_res = text("UPDATE platform.reservas_clase SET estado = 'asistio' WHERE id = :id AND gimnasio_id = :gym_id")
        await session.execute(q_upd_res, {"id": reserva["id"], "gym_id": gym_id})

        # Obtener datos del deportista para la respuesta
        q_dep = text("SELECT nombre, documento FROM platform.deportistas WHERE id = :id")
        dep_data = (await session.execute(q_dep, {"id": req.deportista_id})).mappings().one()

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="REGISTRAR_ASISTENCIA_CLASE",
            entidad="asistencia_clase",
            entidad_id=asist_row["id"],
            detalle={
                "clase_id": str(clase_id),
                "deportista_id": str(req.deportista_id),
                "checkin_id": checkin_row["id"],
            }
        )

        return AsistenciaResponse(
            id=asist_row["id"],
            gimnasio_id=gym_id,
            clase_id=clase_id,
            deportista_id=req.deportista_id,
            deportista_nombre=dep_data["nombre"],
            deportista_documento=dep_data["documento"],
            checkin_id=checkin_row["id"],
            check_in=asist_row["check_in"],
            created_at=asist_row["created_at"],
        )

    @classmethod
    async def obtener_resumen_asistencia(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        clase_id: UUID,
    ) -> ResumenAsistenciaClaseResponse:
        """Obtiene la lista de deportistas asistentes y ausentes de una clase (RF-34)."""
        clase = await cls.obtener_clase(session, gym_id, clase_id)

        # Asistentes
        q_asist = text("""
            SELECT a.id, a.gimnasio_id, a.clase_id, a.deportista_id,
                   d.nombre as deportista_nombre, d.documento as deportista_documento,
                   a.checkin_id, a.check_in, a.created_at
            FROM platform.asistencia_clase a
            JOIN platform.deportistas d ON d.id = a.deportista_id
            WHERE a.clase_id = :clase_id AND a.gimnasio_id = :gym_id
            ORDER BY a.check_in ASC
        """)
        res_a = await session.execute(q_asist, {"clase_id": clase_id, "gym_id": gym_id})
        asistentes = [AsistenciaResponse(**row) for row in res_a.mappings().all()]

        # Ausentes (reservas que quedaron en 'reservada' o 'no_show')
        q_aus = text("""
            SELECT r.id, r.gimnasio_id, r.clase_id, c.nombre as clase_nombre, c.fecha_hora as clase_fecha_hora,
                   r.deportista_id, d.nombre as deportista_nombre, d.documento as deportista_documento,
                   r.estado, r.pase_pagado, r.venta_item_id, r.created_at
            FROM platform.reservas_clase r
            JOIN platform.clases c ON c.id = r.clase_id
            JOIN platform.deportistas d ON d.id = r.deportista_id
            WHERE r.clase_id = :clase_id AND r.gimnasio_id = :gym_id AND r.estado IN ('reservada', 'no_show')
            ORDER BY r.created_at ASC
        """)
        res_aus = await session.execute(q_aus, {"clase_id": clase_id, "gym_id": gym_id})
        ausentes = [ReservaResponse(**row) for row in res_aus.mappings().all()]

        return ResumenAsistenciaClaseResponse(
            clase_id=clase.id,
            clase_nombre=clase.nombre,
            clase_fecha_hora=clase.fecha_hora,
            cupo_total=clase.cupo,
            total_reservas=clase.reservas_totales,
            total_asistieron=len(asistentes),
            total_ausentes=len(ausentes),
            asistentes=asistentes,
            ausentes=ausentes,
        )

    @classmethod
    async def cerrar_clase(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        clase_id: UUID,
    ) -> ClaseResponse:
        """
        Cierra una clase marcándola como 'realizada'.
        Pasa todas las reservas pendientes no asistidas a estado 'no_show' (RF-34: sin penalizar ni liberar cupo).
        """
        clase = await cls.obtener_clase(session, gym_id, clase_id)
        if clase.estado == "cancelada":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "CLASE_CANCELADA", "mensaje": "No se puede cerrar una clase cancelada"}
            )

        # 1. Marcar clase como realizada
        q_clase = text("UPDATE platform.clases SET estado = 'realizada' WHERE id = :id AND gimnasio_id = :gym_id")
        await session.execute(q_clase, {"id": clase_id, "gym_id": gym_id})

        # 2. Pasar reservas no asistidas a 'no_show'
        q_noshow = text("""
            UPDATE platform.reservas_clase
            SET estado = 'no_show'
            WHERE clase_id = :clase_id AND gimnasio_id = :gym_id AND estado = 'reservada'
        """)
        res_ns = await session.execute(q_noshow, {"clase_id": clase_id, "gym_id": gym_id})

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CERRAR_CLASE",
            entidad="clases",
            entidad_id=clase_id,
            detalle={"reservas_no_show": res_ns.rowcount}
        )

        return await cls.obtener_clase(session, gym_id, clase_id)

    @classmethod
    async def calificar_clase(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        clase_id: UUID,
        req: CrearCalificacionRequest,
    ) -> CalificacionResponse:
        """
        Registra la calificación de un deportista sobre una clase asistida (RF-35).
        Exige haber asistido a la clase (platform.asistencia_clase).
        """
        # 1. Validar que la clase existe
        await cls.obtener_clase(session, gym_id, clase_id)

        # 2. Validar que el deportista asistió
        q_asist = text("""
            SELECT id FROM platform.asistencia_clase
            WHERE clase_id = :clase_id AND deportista_id = :dep_id AND gimnasio_id = :gym_id
        """)
        res_a = await session.execute(q_asist, {
            "clase_id": clase_id,
            "dep_id": req.deportista_id,
            "gym_id": gym_id
        })
        if not res_a.mappings().first():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"codigo": "DEPORTISTA_NO_ASISTIO", "mensaje": "Solo los deportistas que asistieron a la clase pueden calificarla"}
            )

        # 3. Insertar calificación
        q_ins = text("""
            INSERT INTO platform.calificaciones_clase (
                gimnasio_id, clase_id, deportista_id, puntaje, comentario
            ) VALUES (
                :gym_id, :clase_id, :dep_id, :puntaje, :comentario
            ) RETURNING id, created_at
        """)
        try:
            res_ins = await session.execute(q_ins, {
                "gym_id": gym_id,
                "clase_id": clase_id,
                "dep_id": req.deportista_id,
                "puntaje": req.puntaje,
                "comentario": req.comentario.strip() if req.comentario else None,
            })
            row = res_ins.mappings().one()
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "CLASE_YA_CALIFICADA", "mensaje": "El deportista ya calificó esta clase previamente"}
            ) from exc

        q_dep = text("SELECT nombre FROM platform.deportistas WHERE id = :id")
        dep_name = (await session.execute(q_dep, {"id": req.deportista_id})).scalar_one()

        return CalificacionResponse(
            id=row["id"],
            gimnasio_id=gym_id,
            clase_id=clase_id,
            deportista_id=req.deportista_id,
            deportista_nombre=dep_name,
            puntaje=req.puntaje,
            comentario=req.comentario,
            created_at=row["created_at"],
        )

    @classmethod
    async def obtener_calificaciones_clase(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        clase_id: UUID,
    ) -> ResumenCalificacionesResponse:
        """Consulta las calificaciones y promedio de satisfacción de una clase."""
        await cls.obtener_clase(session, gym_id, clase_id)
        q = text("""
            SELECT cc.id, cc.gimnasio_id, cc.clase_id, cc.deportista_id,
                   d.nombre as deportista_nombre, cc.puntaje, cc.comentario, cc.created_at
            FROM platform.calificaciones_clase cc
            JOIN platform.deportistas d ON d.id = cc.deportista_id
            WHERE cc.clase_id = :clase_id AND cc.gimnasio_id = :gym_id
            ORDER BY cc.created_at DESC
        """)
        res = await session.execute(q, {"clase_id": clase_id, "gym_id": gym_id})
        items = [CalificacionResponse(**row) for row in res.mappings().all()]

        total = len(items)
        promedio = round(sum(i.puntaje for i in items) / total, 2) if total > 0 else 0.0

        return ResumenCalificacionesResponse(
            clase_id=clase_id,
            promedio_puntaje=promedio,
            total_calificaciones=total,
            calificaciones=items,
        )
