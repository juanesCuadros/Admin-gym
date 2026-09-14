"""Lógica de negocio para el módulo personal (RF-39, RF-40)"""
import math
import uuid
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.dependencies import AuthenticatedStaff
from app.core.security import hash_password, verify_password
from app.modules.caja.service import CajaService
from app.modules.personal.schemas import (
    ActualizarStaffRequest,
    CambiarEstadoStaffRequest,
    CambiarEstadoStaffResponse,
    CrearStaffRequest,
    StaffListResponse,
    StaffResponse,
    TransferirJefeRequest,
    TransferirJefeResponse,
)


class PersonalService:
    """Servicio para la administración del personal, control de estado y transferencia de rol Jefe."""

    @classmethod
    async def listar_staff(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        buscar: Optional[str] = None,
        rol: Optional[str] = None,
        activo: Optional[bool] = None,
        pagina: int = 1,
        limite: int = 20,
    ) -> StaffListResponse:
        pagina = max(1, pagina)
        limite = max(1, min(limite, 100))
        offset = (pagina - 1) * limite

        filters = ["gimnasio_id = :gym_id", "deleted_at IS NULL"]
        params: Dict[str, Any] = {"gym_id": gym_id, "limit": limite, "offset": offset}

        if buscar:
            filters.append("(nombre ILIKE :buscar OR correo ILIKE :buscar)")
            params["buscar"] = f"%{buscar.strip()}%"

        if rol:
            filters.append("rol = :rol")
            params["rol"] = rol.lower().strip()

        if activo is not None:
            filters.append("activo = :activo")
            params["activo"] = activo

        where_clause = " AND ".join(filters)

        count_q = text(f"SELECT COUNT(*) FROM platform.staff WHERE {where_clause}")
        total_res = await session.execute(count_q, params)
        total = total_res.scalar() or 0

        query = text(f"""
            SELECT id, gimnasio_id, nombre, correo, rol, activo,
                   ultimo_ingreso, version, created_at, updated_at
            FROM platform.staff
            WHERE {where_clause}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """)
        res = await session.execute(query, params)
        rows = res.mappings().all()

        items = [StaffResponse(**row) for row in rows]
        total_paginas = max(1, math.ceil(total / limite))

        return StaffListResponse(
            items=items,
            total=total,
            pagina=pagina,
            limite=limite,
            total_paginas=total_paginas,
        )

    @classmethod
    async def obtener_staff(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
    ) -> StaffResponse:
        query = text("""
            SELECT id, gimnasio_id, nombre, correo, rol, activo,
                   ultimo_ingreso, version, created_at, updated_at
            FROM platform.staff
            WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL
        """)
        res = await session.execute(query, {"id": staff_id, "gym_id": gym_id})
        row = res.mappings().first()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "STAFF_NO_ENCONTRADO", "mensaje": "El miembro del personal especificado no existe"},
            )
        return StaffResponse(**row)

    @classmethod
    async def crear_staff(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        data: CrearStaffRequest,
        actor: AuthenticatedStaff,
    ) -> StaffResponse:
        # Pre-validación: el rol 'jefe' no se crea manualmente vía este endpoint
        if data.rol not in ("recepcionista", "entrenador"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "ROL_INVALIDO", "mensaje": "Solo se permite registrar personal con rol 'recepcionista' o 'entrenador'"},
            )

        correo_limpio = str(data.correo).lower().strip()

        # Validación de duplicidad de correo dentro del mismo gimnasio (case-insensitive)
        check_q = text("""
            SELECT id FROM platform.staff
            WHERE gimnasio_id = :gym_id AND LOWER(correo) = :correo
        """)
        existing = await session.execute(check_q, {"gym_id": gym_id, "correo": correo_limpio})
        if existing.scalar():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "CORREO_DUPLICADO", "mensaje": f"Ya existe un miembro del personal registrado con el correo {data.correo}"},
            )

        new_id = uuid.uuid4()
        h_pwd = hash_password(data.password)

        insert_q = text("""
            INSERT INTO platform.staff (
                id, gimnasio_id, nombre, correo, hash_password, rol, activo, version, created_at, updated_at
            ) VALUES (
                :id, :gym_id, :nombre, :correo, :hash_password, :rol, true, 1, now(), now()
            )
            RETURNING id, gimnasio_id, nombre, correo, rol, activo, ultimo_ingreso, version, created_at, updated_at
        """)

        try:
            async with session.begin_nested():
                res = await session.execute(insert_q, {
                    "id": new_id,
                    "gym_id": gym_id,
                    "nombre": data.nombre.strip(),
                    "correo": correo_limpio,
                    "hash_password": h_pwd,
                    "rol": data.rol,
                })
                row = res.mappings().first()
        except IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "CORREO_DUPLICADO", "mensaje": f"Conflicto de unicidad: ya existe un usuario con el correo {data.correo} en este gimnasio"},
            )

        # Registro de auditoría append-only
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="CREAR_STAFF",
            entidad="staff",
            entidad_id=row["id"],
            detalle={
                "nombre": row["nombre"],
                "correo": row["correo"],
                "rol": row["rol"],
            },
        )

        return StaffResponse(**row)

    @classmethod
    async def actualizar_staff(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        data: ActualizarStaffRequest,
        actor: AuthenticatedStaff,
    ) -> StaffResponse:
        # 1. Obtener staff existente
        query_target = text("""
            SELECT id, rol, activo, version
            FROM platform.staff
            WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL
        """)
        res_target = await session.execute(query_target, {"id": staff_id, "gym_id": gym_id})
        target = res_target.mappings().first()
        if not target:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "STAFF_NO_ENCONTRADO", "mensaje": "El miembro del personal especificado no existe"},
            )

        # Regla 1: No se puede editar al Jefe mediante este endpoint
        if target["rol"] == "jefe":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "OPERACION_INVALIDA_SOBRE_JEFE", "mensaje": "No se puede editar los datos del Jefe del gimnasio mediante este endpoint"},
            )

        # Pre-validar duplicidad de correo excluyendo al mismo usuario
        correo_limpio = str(data.correo).lower().strip()
        check_q = text("""
            SELECT id FROM platform.staff
            WHERE gimnasio_id = :gym_id AND LOWER(correo) = :correo AND id != :id
        """)
        existing = await session.execute(check_q, {"gym_id": gym_id, "correo": correo_limpio, "id": staff_id})
        if existing.scalar():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "CORREO_DUPLICADO", "mensaje": f"Ya existe otro miembro del personal registrado con el correo {data.correo}"},
            )

        # Concurrencia optimista con version
        update_q = text("""
            UPDATE platform.staff
            SET nombre = :nombre,
                correo = :correo,
                rol = :rol,
                version = version + 1,
                updated_at = now()
            WHERE id = :id AND gimnasio_id = :gym_id AND version = :version_esperada AND deleted_at IS NULL
            RETURNING id, gimnasio_id, nombre, correo, rol, activo, ultimo_ingreso, version, created_at, updated_at
        """)

        try:
            async with session.begin_nested():
                res = await session.execute(update_q, {
                    "id": staff_id,
                    "gym_id": gym_id,
                    "nombre": data.nombre.strip(),
                    "correo": correo_limpio,
                    "rol": data.rol,
                    "version_esperada": data.version,
                })
                row = res.mappings().first()
        except IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "CORREO_DUPLICADO", "mensaje": f"Ya existe un miembro del personal registrado con el correo {data.correo}"},
            )

        if not row:
            # Verificar si existe para distinguir entre 404 y 409
            check_exist = await session.execute(
                text("SELECT version FROM platform.staff WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL"),
                {"id": staff_id, "gym_id": gym_id}
            )
            v_curr = check_exist.scalar()
            if v_curr is not None:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "codigo": "CONFLICTO_CONCURRENCIA",
                        "mensaje": "El miembro del personal fue modificado concurrentemente por otro usuario. Recargue los datos e intente nuevamente.",
                        "version_esperada": data.version,
                        "version_actual": v_curr
                    }
                )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "STAFF_NO_ENCONTRADO", "mensaje": "El miembro del personal especificado no existe"},
            )

        # Registro de auditoría
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="EDITAR_STAFF",
            entidad="staff",
            entidad_id=row["id"],
            detalle={
                "nombre": row["nombre"],
                "correo": row["correo"],
                "rol": row["rol"],
                "version_anterior": data.version,
                "version_nueva": row["version"],
            },
        )

        return StaffResponse(**row)

    @classmethod
    async def cambiar_estado(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        data: CambiarEstadoStaffRequest,
        actor: AuthenticatedStaff,
    ) -> CambiarEstadoStaffResponse:
        # Confirmación 2: El usuario no puede alterar el estado de su propia cuenta
        if staff_id == actor.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "AUTO_MODIFICACION_NO_PERMITIDA", "mensaje": "No puede modificar el estado de su propia cuenta de usuario"},
            )

        # Obtener staff objetivo
        query_target = text("""
            SELECT id, nombre, rol, activo, version
            FROM platform.staff
            WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL
        """)
        res_target = await session.execute(query_target, {"id": staff_id, "gym_id": gym_id})
        target = res_target.mappings().first()
        if not target:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "STAFF_NO_ENCONTRADO", "mensaje": "El miembro del personal especificado no existe"},
            )

        # Confirmación 1: No se puede desactivar a un usuario con rol 'jefe'
        if target["rol"] == "jefe":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "OPERACION_INVALIDA_SOBRE_JEFE", "mensaje": "No se puede desactivar al Jefe del gimnasio"},
            )

        turno_cerrado = False
        turno_id_cerrado: Optional[UUID] = None

        # Si se va a desactivar (activo=False):
        if not data.activo:
            # Si el staff es recepcionista, verificar si tiene turnos de caja abiertos (RF-39)
            if target["rol"] == "recepcionista":
                q_turnos = text("""
                    SELECT id FROM platform.turnos_caja
                    WHERE gimnasio_id = :gym_id AND staff_id = :staff_id AND estado = 'abierto'
                """)
                turnos_res = await session.execute(q_turnos, {"gym_id": gym_id, "staff_id": staff_id})
                turnos_abiertos = turnos_res.fetchall()

                for t_row in turnos_abiertos:
                    t_id = t_row[0]
                    # Invocación directa a CajaService.cerrar_turno_forzado dentro de la misma sesión/transacción (todo o nada)
                    await CajaService.cerrar_turno_forzado(
                        session=session,
                        gym_id=gym_id,
                        turno_id=t_id,
                        actor_id=actor.id,
                        actor_nombre=actor.nombre,
                        motivo=f"Cierre forzado automático por desactivación de recepcionista ({data.motivo or 'Desactivación administrativa'})",
                        efectivo_contado=None,
                    )
                    turno_cerrado = True
                    turno_id_cerrado = t_id

            # Revocar todas las sesiones activas en sesiones_staff
            await session.execute(
                text("DELETE FROM platform.sesiones_staff WHERE staff_id = :staff_id"),
                {"staff_id": staff_id}
            )

        # Actualizar estado activo en staff
        update_q = text("""
            UPDATE platform.staff
            SET activo = :activo,
                version = version + 1,
                updated_at = now()
            WHERE id = :id AND gimnasio_id = :gym_id
        """)
        await session.execute(update_q, {"activo": data.activo, "id": staff_id, "gym_id": gym_id})

        # Auditoría append-only
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="CAMBIAR_ESTADO_STAFF",
            entidad="staff",
            entidad_id=staff_id,
            detalle={
                "nombre": target["nombre"],
                "activo_anterior": target["activo"],
                "activo_nuevo": data.activo,
                "motivo": data.motivo,
                "turno_cerrado_forzado": turno_cerrado,
                "turno_id_cerrado": str(turno_id_cerrado) if turno_id_cerrado else None,
            },
        )

        mensaje_extra = " Se cerró forzadamente su turno de caja abierto." if turno_cerrado else ""
        estado_txt = "activado" if data.activo else "desactivado"

        return CambiarEstadoStaffResponse(
            id=staff_id,
            nombre=target["nombre"],
            activo=data.activo,
            turno_cerrado_forzado=turno_cerrado,
            turno_id_cerrado=turno_id_cerrado,
            mensaje=f"Personal {target['nombre']} {estado_txt} exitosamente.{mensaje_extra}",
        )

    @classmethod
    async def eliminar_staff(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        actor: AuthenticatedStaff,
    ) -> Dict[str, Any]:
        # Confirmación 2: El usuario no puede auto-eliminarse
        if staff_id == actor.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "AUTO_MODIFICACION_NO_PERMITIDA", "mensaje": "No puede eliminar su propia cuenta de usuario"},
            )

        # Obtener staff objetivo
        query_target = text("""
            SELECT id, nombre, rol, activo
            FROM platform.staff
            WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL
        """)
        res_target = await session.execute(query_target, {"id": staff_id, "gym_id": gym_id})
        target = res_target.mappings().first()
        if not target:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "STAFF_NO_ENCONTRADO", "mensaje": "El miembro del personal especificado no existe"},
            )

        # Confirmación 1: No se puede eliminar a un usuario con rol 'jefe' (evita dejar el gimnasio acéfalo)
        if target["rol"] == "jefe":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "OPERACION_INVALIDA_SOBRE_JEFE", "mensaje": "No se puede eliminar al Jefe del gimnasio. Debe transferir el rol de Jefe primero."},
            )

        # Si el staff es recepcionista y tiene un turno abierto, cerrarlo forzadamente
        if target["rol"] == "recepcionista":
            q_turnos = text("""
                SELECT id FROM platform.turnos_caja
                WHERE gimnasio_id = :gym_id AND staff_id = :staff_id AND estado = 'abierto'
            """)
            turnos_res = await session.execute(q_turnos, {"gym_id": gym_id, "staff_id": staff_id})
            for t_row in turnos_res.fetchall():
                await CajaService.cerrar_turno_forzado(
                    session=session,
                    gym_id=gym_id,
                    turno_id=t_row[0],
                    actor_id=actor.id,
                    actor_nombre=actor.nombre,
                    motivo="Cierre forzado automático por eliminación del recepcionista",
                    efectivo_contado=None,
                )

        # Revocar sesiones activas
        await session.execute(
            text("DELETE FROM platform.sesiones_staff WHERE staff_id = :staff_id"),
            {"staff_id": staff_id}
        )

        # Eliminación lógica (soft delete)
        await session.execute(
            text("""
                UPDATE platform.staff
                SET deleted_at = now(),
                    activo = false,
                    updated_at = now()
                WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL
            """),
            {"id": staff_id, "gym_id": gym_id}
        )

        # Auditoría append-only
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="ELIMINAR_STAFF",
            entidad="staff",
            entidad_id=staff_id,
            detalle={
                "nombre": target["nombre"],
                "rol": target["rol"],
            },
        )

        return {"mensaje": "Miembro del personal eliminado correctamente", "id": str(staff_id)}

    @classmethod
    async def transferir_jefe(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        data: TransferirJefeRequest,
        actor: AuthenticatedStaff,
    ) -> TransferirJefeResponse:
        """
        Transferencia atómica del rol de Jefe (RF-40).
        Satisface la restricción CREATE UNIQUE INDEX ux_un_jefe_por_gym ... WHERE rol = 'jefe' AND deleted_at IS NULL:
        1. Valida contraseña del Jefe saliente.
        2. Valida idoneidad del candidato (activo, perteneciente al gimnasio, rol != jefe).
        3. Degrada al Jefe actual a nuevo_rol_antiguo_jefe (libera el slot en el índice único).
        4. Asciende al candidato a rol = 'jefe' (ocupa el slot único).
        5. Revoca sesiones activas del Jefe saliente.
        6. Si el candidato tenía turnos de caja abiertos, los cierra forzadamente.
        7. Registra auditoría append-only.
        """
        if data.nuevo_jefe_id == actor.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "TRANSFERENCIA_INVALIDA", "mensaje": "No puede transferirse el rol de Jefe a usted mismo"},
            )

        # 1. Validar contraseña de confirmación del Jefe saliente
        q_pass = text("SELECT hash_password FROM platform.staff WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL")
        res_pass = await session.execute(q_pass, {"id": actor.id, "gym_id": gym_id})
        pwd_hash = res_pass.scalar()
        if not pwd_hash or not verify_password(data.password_confirmacion, pwd_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "PASSWORD_INCORRECTA", "mensaje": "La contraseña de confirmación es incorrecta"},
            )

        # 2. Validar candidato
        q_cand = text("""
            SELECT id, nombre, rol, activo
            FROM platform.staff
            WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL
        """)
        res_cand = await session.execute(q_cand, {"id": data.nuevo_jefe_id, "gym_id": gym_id})
        cand = res_cand.mappings().first()

        if not cand:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "STAFF_NO_ENCONTRADO", "mensaje": "El candidato a Jefe no existe en este gimnasio"},
            )
        if not cand["activo"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "STAFF_INACTIVO", "mensaje": "El candidato a Jefe se encuentra inactivo. Debe activarlo antes de transferirle el rol"},
            )
        if cand["rol"] == "jefe":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "ROL_YA_ASIGNADO", "mensaje": "El candidato ya posee el rol de Jefe"},
            )

        # Si el candidato tenía un turno de caja abierto como recepcionista, lo cerramos forzadamente
        if cand["rol"] == "recepcionista":
            q_turnos_cand = text("""
                SELECT id FROM platform.turnos_caja
                WHERE gimnasio_id = :gym_id AND staff_id = :staff_id AND estado = 'abierto'
            """)
            turnos_cand_res = await session.execute(q_turnos_cand, {"gym_id": gym_id, "staff_id": data.nuevo_jefe_id})
            for tc_row in turnos_cand_res.fetchall():
                await CajaService.cerrar_turno_forzado(
                    session=session,
                    gym_id=gym_id,
                    turno_id=tc_row[0],
                    actor_id=actor.id,
                    actor_nombre=actor.nombre,
                    motivo="Cierre forzado automático por transferencia y ascenso al rol de Jefe",
                    efectivo_contado=None,
                )

        # 3. Degradar al Jefe actual (libera el slot en ux_un_jefe_por_gym)
        await session.execute(
            text("""
                UPDATE platform.staff
                SET rol = :nuevo_rol,
                    version = version + 1,
                    updated_at = now()
                WHERE id = :current_id AND gimnasio_id = :gym_id
            """),
            {
                "nuevo_rol": data.nuevo_rol_antiguo_jefe,
                "current_id": actor.id,
                "gym_id": gym_id,
            }
        )

        # 4. Ascender al candidato a rol = 'jefe' (ocupa el slot único)
        await session.execute(
            text("""
                UPDATE platform.staff
                SET rol = 'jefe',
                    version = version + 1,
                    updated_at = now()
                WHERE id = :cand_id AND gimnasio_id = :gym_id
            """),
            {
                "cand_id": data.nuevo_jefe_id,
                "gym_id": gym_id,
            }
        )

        # 5. Revocar sesiones activas del antiguo Jefe para forzar re-login con nuevo rol
        await session.execute(
            text("DELETE FROM platform.sesiones_staff WHERE staff_id = :current_id"),
            {"current_id": actor.id}
        )

        # 6. Auditoría append-only
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor.id,
            actor_nombre=actor.nombre,
            accion="TRANSFERENCIA_ROL_JEFE",
            entidad="staff",
            entidad_id=data.nuevo_jefe_id,
            detalle={
                "antiguo_jefe_id": str(actor.id),
                "antiguo_jefe_nuevo_rol": data.nuevo_rol_antiguo_jefe,
                "nuevo_jefe_id": str(data.nuevo_jefe_id),
                "nuevo_jefe_nombre": cand["nombre"],
            },
        )

        return TransferirJefeResponse(
            antiguo_jefe_id=actor.id,
            antiguo_jefe_nuevo_rol=data.nuevo_rol_antiguo_jefe,
            nuevo_jefe_id=data.nuevo_jefe_id,
            nuevo_jefe_nombre=cand["nombre"],
            mensaje=f"Rol de Jefe transferido exitosamente a {cand['nombre']}. El Jefe anterior ahora tiene el rol {data.nuevo_rol_antiguo_jefe}.",
        )
