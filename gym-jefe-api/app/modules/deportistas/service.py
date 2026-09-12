"""
Servicio de negocio para el Módulo 4: Deportistas y Biometría (RF-17 a RF-23).
Gestiona registro, control de concurrencia optimista, búsqueda indexada, ficha 360°,
cifrado biométrico AES-256-GCM, enrolamiento y supresión de datos bajo Ley 1581.
"""
import base64
import secrets
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.config import settings
from app.core.security import encrypt_biometric_template, hash_token
from app.modules.deportistas.schemas import (
    AccesoFichaResponse,
    CambiarEstadoDeportistaRequest,
    CrearDeportistaRequest,
    CuentaAppInfoResponse,
    DeportistaBuscarResponse,
    DeportistaResponse,
    DeportistaResumenResponse,
    DeportistasPaginadosResponse,
    EditarDeportistaRequest,
    EnrolarHuellaRequest,
    FichaDeportistaResponse,
    HuellaInfoResponse,
    InvitacionAppResponse,
    MedicionCorporalResponse,
    MembresiaFichaResponse,
    PagoFichaResponse,
    RegistrarMedicionRequest,
    SuprimirDatosRequest,
)

BOGOTA_TZ = ZoneInfo("America/Bogota")


class DeportistasService:

    @staticmethod
    def _obtener_fecha_hoy_bogota() -> date:
        """Retorna la fecha actual en la zona horaria operativa del gimnasio."""
        return datetime.now(BOGOTA_TZ).date()

    # =====================================================================
    # 1. Crear Deportista (RF-17, RF-19)
    # =====================================================================
    @classmethod
    async def crear_deportista(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        req: CrearDeportistaRequest,
    ) -> DeportistaResponse:
        """
        Pre-registra o registra un deportista.
        Exige consentimiento_1581 = true y estampa consentimiento_fecha autoritativamente.
        Protege la unicidad por gimnasio (ux_dep_documento_gym) dentro de un savepoint.
        """
        now_utc = datetime.now(timezone.utc)

        insert_query = text("""
            INSERT INTO platform.deportistas (
                gimnasio_id, documento, nombre, correo, telefono,
                sexo, fecha_nacimiento, altura_cm,
                consentimiento_1581, consentimiento_fecha,
                acudiente_nombre, activo, version,
                created_at, updated_at
            ) VALUES (
                :gym_id, :documento, :nombre, :correo, :telefono,
                :sexo, :fecha_nacimiento, :altura_cm,
                :consentimiento_1581, :consentimiento_fecha,
                :acudiente_nombre, true, 1,
                :now_utc, :now_utc
            )
            RETURNING id, gimnasio_id, documento, nombre, correo, telefono,
                      sexo, fecha_nacimiento, altura_cm,
                      consentimiento_1581, consentimiento_fecha,
                      acudiente_nombre, activo, version, created_at, updated_at;
        """)

        params = {
            "gym_id": gym_id,
            "documento": req.documento,
            "nombre": req.nombre,
            "correo": str(req.correo) if req.correo else None,
            "telefono": req.telefono,
            "sexo": req.sexo,
            "fecha_nacimiento": req.fecha_nacimiento,
            "altura_cm": req.altura_cm,
            "consentimiento_1581": req.consentimiento_1581,
            "consentimiento_fecha": now_utc,
            "acudiente_nombre": req.acudiente_nombre,
            "now_utc": now_utc,
        }

        try:
            async with session.begin_nested():
                res = await session.execute(insert_query, params)
                row = res.mappings().one()
        except IntegrityError as exc:
            err_msg = str(exc.orig) if hasattr(exc, "orig") else str(exc)
            if "ux_dep_documento_gym" in err_msg or "deportistas_gimnasio_id_documento_key" in err_msg:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "codigo": "DOCUMENTO_YA_REGISTRADO",
                        "mensaje": f"Ya existe un deportista con el documento '{req.documento}' en este gimnasio.",
                    },
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "ERROR_INTEGRIDAD", "mensaje": "Violación de restricción de datos en base de datos."},
            )

        # Auditoría inmutable en platform.auditoria_gym
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CREAR",
            entidad="deportistas",
            entidad_id=str(row["id"]),
            detalle={"documento": req.documento, "nombre": req.nombre},
        )

        return DeportistaResponse(**row)

    # =====================================================================
    # 2. Listar Deportistas Paginado (RF-17, RNF-09)
    # =====================================================================
    @classmethod
    async def listar_deportistas(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        q: Optional[str] = None,
        activo: Optional[bool] = None,
        skip: int = 0,
        limit: int = 50,
        orden_por: str = "nombre",
        direccion: str = "asc",
    ) -> DeportistasPaginadosResponse:
        """
        Lista deportistas con paginación, filtros y cálculo en tiempo real
        del estado de su membresía operativa.
        """
        today_bogota = cls._obtener_fecha_hoy_bogota()

        # Validar whitelist de ordenamiento
        valid_orders = {
            "nombre": "d.nombre",
            "documento": "d.documento",
            "created_at": "d.created_at",
        }
        order_col = valid_orders.get(orden_por.lower(), "d.nombre")
        order_dir = "DESC" if direccion.lower() == "desc" else "ASC"

        # Construcción dinámica de condiciones
        condiciones = ["d.gimnasio_id = :gym_id", "d.deleted_at IS NULL"]
        params: Dict[str, Any] = {
            "gym_id": gym_id,
            "today": today_bogota,
            "skip": skip,
            "limit": limit,
        }

        if activo is not None:
            condiciones.append("d.activo = :activo")
            params["activo"] = activo

        if q and q.strip():
            condiciones.append("(d.documento ILIKE :q_like OR d.nombre ILIKE :q_like)")
            params["q_like"] = f"%{q.strip()}%"

        where_clause = " AND ".join(condiciones)

        # 1. Total count
        count_query = text(f"""
            SELECT COUNT(*) FROM platform.deportistas d
            WHERE {where_clause}
        """)
        res_count = await session.execute(count_query, params)
        total = res_count.scalar_one()

        # 2. Items con resolución de membresía más reciente
        items_query = text(f"""
            SELECT
                d.id,
                d.documento,
                d.nombre,
                d.correo,
                d.telefono,
                d.activo,
                d.version,
                d.created_at,
                m.plan_nombre,
                m.fecha_vencimiento,
                CASE
                    WHEN m.id IS NULL THEN 'sin_membresia'
                    WHEN m.esta_congelada THEN 'congelado'
                    WHEN m.fecha_vencimiento >= :today THEN
                        CASE
                            WHEN (m.fecha_vencimiento - :today) <= t.dias_umbral_por_vencer THEN 'por_vencer'
                            ELSE 'al_dia'
                        END
                    ELSE
                        CASE
                            WHEN (:today - m.fecha_vencimiento) <= t.dias_gracia_mora THEN 'en_mora'
                            ELSE 'vencido'
                        END
                END AS estado_membresia
            FROM platform.deportistas d
            JOIN platform.tenant t ON t.id = d.gimnasio_id
            LEFT JOIN LATERAL (
                SELECT
                    mb.id,
                    mb.plan_id,
                    p.nombre AS plan_nombre,
                    mb.fecha_vencimiento,
                    EXISTS (
                        SELECT 1 FROM platform.congelamientos c
                        WHERE c.membresia_id = mb.id
                          AND c.fecha_inicio <= :today
                          AND (c.fecha_fin IS NULL OR c.fecha_fin >= :today)
                    ) AS esta_congelada
                FROM platform.membresias mb
                JOIN platform.planes p ON p.id = mb.plan_id
                WHERE mb.deportista_id = d.id
                  AND mb.gimnasio_id = :gym_id
                  AND mb.cancelada = false
                ORDER BY mb.fecha_vencimiento DESC, mb.created_at DESC
                LIMIT 1
            ) m ON true
            WHERE {where_clause}
            ORDER BY {order_col} {order_dir}
            OFFSET :skip LIMIT :limit;
        """)

        res_items = await session.execute(items_query, params)
        items = [DeportistaResumenResponse(**row) for row in res_items.mappings().all()]

        return DeportistasPaginadosResponse(
            items=items,
            total=total,
            skip=skip,
            limit=limit,
        )

    # =====================================================================
    # 3. Búsqueda Rápida Autocompletado (RF-17)
    # =====================================================================
    @classmethod
    async def buscar_deportistas(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        q: str,
        limit: int = 10,
    ) -> List[DeportistaBuscarResponse]:
        """
        Búsqueda rápida por cédula o nombre para cajas y recepción.
        """
        today_bogota = cls._obtener_fecha_hoy_bogota()
        q_clean = q.strip()
        if not q_clean:
            return []

        search_query = text("""
            SELECT
                d.id,
                d.documento,
                d.nombre,
                d.correo,
                d.telefono,
                d.activo,
                CASE
                    WHEN m.id IS NULL THEN 'sin_membresia'
                    WHEN m.esta_congelada THEN 'congelado'
                    WHEN m.fecha_vencimiento >= :today THEN
                        CASE
                            WHEN (m.fecha_vencimiento - :today) <= t.dias_umbral_por_vencer THEN 'por_vencer'
                            ELSE 'al_dia'
                        END
                    ELSE
                        CASE
                            WHEN (:today - m.fecha_vencimiento) <= t.dias_gracia_mora THEN 'en_mora'
                            ELSE 'vencido'
                        END
                END AS estado_membresia
            FROM platform.deportistas d
            JOIN platform.tenant t ON t.id = d.gimnasio_id
            LEFT JOIN LATERAL (
                SELECT
                    mb.id,
                    mb.fecha_vencimiento,
                    EXISTS (
                        SELECT 1 FROM platform.congelamientos c
                        WHERE c.membresia_id = mb.id
                          AND c.fecha_inicio <= :today
                          AND (c.fecha_fin IS NULL OR c.fecha_fin >= :today)
                    ) AS esta_congelada
                FROM platform.membresias mb
                WHERE mb.deportista_id = d.id
                  AND mb.gimnasio_id = :gym_id
                  AND mb.cancelada = false
                ORDER BY mb.fecha_vencimiento DESC, mb.created_at DESC
                LIMIT 1
            ) m ON true
            WHERE d.gimnasio_id = :gym_id
              AND d.deleted_at IS NULL
              AND (d.documento ILIKE :q_like OR d.nombre ILIKE :q_like)
            ORDER BY d.nombre ASC
            LIMIT :limit;
        """)

        res = await session.execute(
            search_query,
            {
                "gym_id": gym_id,
                "today": today_bogota,
                "q_like": f"%{q_clean}%",
                "limit": min(limit, 20),
            },
        )
        return [DeportistaBuscarResponse(**row) for row in res.mappings().all()]

    # =====================================================================
    # 4. Ficha 360° del Deportista (RF-20)
    # =====================================================================
    @classmethod
    async def obtener_ficha(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        deportista_id: UUID,
    ) -> FichaDeportistaResponse:
        """
        Retorna la ficha integral del deportista: datos básicos, membresía vigente,
        historial de pagos, accesos recientes, mediciones, huellas y cuenta móvil.
        """
        today_bogota = cls._obtener_fecha_hoy_bogota()

        # 1. Datos del deportista
        dep_query = text("""
            SELECT id, gimnasio_id, documento, nombre, correo, telefono,
                   sexo, fecha_nacimiento, altura_cm,
                   consentimiento_1581, consentimiento_fecha,
                   acudiente_nombre, activo, version, created_at, updated_at
            FROM platform.deportistas
            WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL;
        """)
        res_dep = await session.execute(dep_query, {"id": deportista_id, "gym_id": gym_id})
        row_dep = res_dep.mappings().one_or_none()
        if not row_dep:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado."},
            )
        deportista_dto = DeportistaResponse(**row_dep)

        # 2. Membresía vigente
        memb_query = text("""
            SELECT
                m.id,
                m.plan_id,
                p.nombre AS plan_nombre,
                m.fecha_inicio,
                m.fecha_vencimiento,
                m.cancelada,
                (m.fecha_vencimiento - :today) AS dias_restantes,
                EXISTS (
                    SELECT 1 FROM platform.congelamientos c
                    WHERE c.membresia_id = m.id
                      AND c.fecha_inicio <= :today
                      AND (c.fecha_fin IS NULL OR c.fecha_fin >= :today)
                ) AS congelado,
                t.dias_gracia_mora,
                t.dias_umbral_por_vencer
            FROM platform.membresias m
            JOIN platform.planes p ON p.id = m.plan_id
            JOIN platform.tenant t ON t.id = m.gimnasio_id
            WHERE m.deportista_id = :id
              AND m.gimnasio_id = :gym_id
              AND m.cancelada = false
            ORDER BY m.fecha_vencimiento DESC, m.created_at DESC
            LIMIT 1;
        """)
        res_memb = await session.execute(memb_query, {"id": deportista_id, "gym_id": gym_id, "today": today_bogota})
        row_memb = res_memb.mappings().one_or_none()
        membresia_dto: Optional[MembresiaFichaResponse] = None
        if row_memb:
            if row_memb["congelado"]:
                estado_m = "congelado"
            elif row_memb["fecha_vencimiento"] >= today_bogota:
                dias_rest = row_memb["dias_restantes"]
                estado_m = "por_vencer" if dias_rest <= row_memb["dias_umbral_por_vencer"] else "al_dia"
            else:
                dias_vencido = (today_bogota - row_memb["fecha_vencimiento"]).days
                estado_m = "en_mora" if dias_vencido <= row_memb["dias_gracia_mora"] else "vencido"

            membresia_dto = MembresiaFichaResponse(
                id=row_memb["id"],
                plan_id=row_memb["plan_id"],
                plan_nombre=row_memb["plan_nombre"],
                fecha_inicio=row_memb["fecha_inicio"],
                fecha_vencimiento=row_memb["fecha_vencimiento"],
                cancelada=row_memb["cancelada"],
                dias_restantes=row_memb["dias_restantes"],
                congelado=row_memb["congelado"],
                estado=estado_m,
            )

        # 3. Historial de últimos 10 pagos
        pagos_query = text("""
            SELECT pm.id, pm.monto, pm.metodo, pm.tipo_medio, pm.dias_agregados,
                   pm.anulado, pm.created_at
            FROM platform.pagos_membresia pm
            JOIN platform.membresias m ON m.id = pm.membresia_id
            WHERE m.deportista_id = :id AND pm.gimnasio_id = :gym_id
            ORDER BY pm.created_at DESC
            LIMIT 10;
        """)
        res_pagos = await session.execute(pagos_query, {"id": deportista_id, "gym_id": gym_id})
        ultimos_pagos = [PagoFichaResponse(**r) for r in res_pagos.mappings().all()]

        # 4. Últimos 10 accesos (con conversión a hora Colombia)
        accesos_query = text("""
            SELECT c.id, c.tipo, c.metodo, c.resultado,
                   c.ts_utc AT TIME ZONE 'America/Bogota' AS ts_bogota
            FROM platform.checkins c
            WHERE c.deportista_id = :id AND c.gimnasio_id = :gym_id
            ORDER BY c.ts_utc DESC
            LIMIT 10;
        """)
        res_accesos = await session.execute(accesos_query, {"id": deportista_id, "gym_id": gym_id})
        ultimos_accesos = [AccesoFichaResponse(**r) for r in res_accesos.mappings().all()]

        # 5. Últimas 5 mediciones corporales
        mediciones_query = text("""
            SELECT mc.id, mc.fecha, mc.peso, mc.grasa_pct, mc.masa_muscular,
                   mc.cintura, mc.cadera, mc.brazo, mc.pierna, mc.pecho,
                   mc.registrado_por, s.nombre AS registrado_por_nombre, mc.created_at
            FROM platform.mediciones_corporales mc
            LEFT JOIN platform.staff s ON s.id = mc.registrado_por
            WHERE mc.deportista_id = :id AND mc.gimnasio_id = :gym_id
            ORDER BY mc.fecha DESC, mc.created_at DESC
            LIMIT 5;
        """)
        res_med = await session.execute(mediciones_query, {"id": deportista_id, "gym_id": gym_id})
        mediciones_recientes = [MedicionCorporalResponse(**r) for r in res_med.mappings().all()]

        # 6. Huellas enroladas (solo metadatos, NUNCA expone el template)
        huellas_query = text("""
            SELECT id, dedo, created_at
            FROM platform.huellas
            WHERE deportista_id = :id AND gimnasio_id = :gym_id
            ORDER BY created_at ASC;
        """)
        res_huellas = await session.execute(huellas_query, {"id": deportista_id, "gym_id": gym_id})
        huellas_enroladas = [HuellaInfoResponse(**r) for r in res_huellas.mappings().all()]

        # 7. Cuenta App e Invitaciones
        cuenta_query = text("""
            SELECT id, correo, activa, ultimo_ingreso
            FROM platform.cuentas_app
            WHERE deportista_id = :id AND gimnasio_id = :gym_id;
        """)
        res_cuenta = await session.execute(cuenta_query, {"id": deportista_id, "gym_id": gym_id})
        row_cuenta = res_cuenta.mappings().one_or_none()

        inv_query = text("""
            SELECT id, expira_en, estado
            FROM platform.invitaciones_app
            WHERE deportista_id = :id AND gimnasio_id = :gym_id AND estado = 'pendiente' AND expira_en > now()
            ORDER BY created_at DESC LIMIT 1;
        """)
        res_inv = await session.execute(inv_query, {"id": deportista_id, "gym_id": gym_id})
        row_inv = res_inv.mappings().one_or_none()

        cuenta_app_dto = CuentaAppInfoResponse(
            id=row_cuenta["id"] if row_cuenta else None,
            correo=row_cuenta["correo"] if row_cuenta else None,
            activa=row_cuenta["activa"] if row_cuenta else False,
            ultimo_ingreso=row_cuenta["ultimo_ingreso"] if row_cuenta else None,
            invitacion_pendiente=True if row_inv else False,
            invitacion_expira_en=row_inv["expira_en"] if row_inv else None,
        )

        return FichaDeportistaResponse(
            deportista=deportista_dto,
            membresia_actual=membresia_dto,
            ultimos_pagos=ultimos_pagos,
            ultimos_accesos=ultimos_accesos,
            mediciones_recientes=mediciones_recientes,
            huellas_enroladas=huellas_enroladas,
            cuenta_app=cuenta_app_dto,
        )

    # =====================================================================
    # 5. Editar Deportista (Control de Concurrencia Optimista)
    # =====================================================================
    @classmethod
    async def editar_deportista(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        deportista_id: UUID,
        req: EditarDeportistaRequest,
    ) -> DeportistaResponse:
        """
        Actualiza un deportista utilizando control de concurrencia optimista estricto.
        Compara `version = :version_esperada`. Si otra transacción lo modificó,
        responde 409 CONFLICT sin usar bloqueos pesimistas.
        """
        # 1. Si se actualiza el documento, verificar que no colisione con otro deportista
        if req.documento is not None:
            check_doc = text("""
                SELECT 1 FROM platform.deportistas
                WHERE gimnasio_id = :gym_id
                  AND documento = :doc
                  AND id != :id
                  AND deleted_at IS NULL;
            """)
            res_doc = await session.execute(check_doc, {"gym_id": gym_id, "doc": req.documento, "id": deportista_id})
            if res_doc.scalar_one_or_none():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "codigo": "DOCUMENTO_YA_REGISTRADO",
                        "mensaje": f"El documento '{req.documento}' ya está registrado en otro deportista de este gimnasio.",
                    },
                )

        now_utc = datetime.now(timezone.utc)

        update_query = text("""
            UPDATE platform.deportistas
            SET documento = COALESCE(:documento, documento),
                nombre = COALESCE(:nombre, nombre),
                correo = CASE WHEN :correo_provided THEN :correo ELSE correo END,
                telefono = CASE WHEN :telefono_provided THEN :telefono ELSE telefono END,
                sexo = CASE WHEN :sexo_provided THEN :sexo ELSE sexo END,
                fecha_nacimiento = CASE WHEN :fecha_nac_provided THEN :fecha_nacimiento ELSE fecha_nacimiento END,
                altura_cm = CASE WHEN :altura_provided THEN :altura_cm ELSE altura_cm END,
                acudiente_nombre = CASE WHEN :acudiente_provided THEN :acudiente_nombre ELSE acudiente_nombre END,
                version = version + 1,
                updated_at = :now_utc
            WHERE id = :id
              AND gimnasio_id = :gym_id
              AND version = :version_esperada
              AND deleted_at IS NULL
            RETURNING id, gimnasio_id, documento, nombre, correo, telefono,
                      sexo, fecha_nacimiento, altura_cm,
                      consentimiento_1581, consentimiento_fecha,
                      acudiente_nombre, activo, version, created_at, updated_at;
        """)

        params = {
            "id": deportista_id,
            "gym_id": gym_id,
            "version_esperada": req.version,
            "now_utc": now_utc,
            "documento": req.documento,
            "nombre": req.nombre,
            "correo_provided": req.correo is not None,
            "correo": str(req.correo) if req.correo else None,
            "telefono_provided": req.telefono is not None,
            "telefono": req.telefono,
            "sexo_provided": req.sexo is not None,
            "sexo": req.sexo,
            "fecha_nac_provided": req.fecha_nacimiento is not None,
            "fecha_nacimiento": req.fecha_nacimiento,
            "altura_provided": req.altura_cm is not None,
            "altura_cm": req.altura_cm,
            "acudiente_provided": req.acudiente_nombre is not None,
            "acudiente_nombre": req.acudiente_nombre,
        }

        try:
            async with session.begin_nested():
                res = await session.execute(update_query, params)
                row = res.mappings().one_or_none()
        except IntegrityError as exc:
            err_msg = str(exc.orig) if hasattr(exc, "orig") else str(exc)
            if "ux_dep_documento_gym" in err_msg:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "codigo": "DOCUMENTO_YA_REGISTRADO",
                        "mensaje": "El documento ya pertenece a otro deportista activo en este gimnasio.",
                    },
                )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "ERROR_INTEGRIDAD", "mensaje": "Violación de restricción de base de datos."},
            )

        if not row:
            # Investigar causa de cero filas afectadas: ¿inexistente o conflicto de versión?
            check_existencia = text("""
                SELECT version, deleted_at FROM platform.deportistas
                WHERE id = :id AND gimnasio_id = :gym_id;
            """)
            res_ex = await session.execute(check_existencia, {"id": deportista_id, "gym_id": gym_id})
            actual = res_ex.mappings().one_or_none()
            if not actual or actual["deleted_at"] is not None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado."},
                )
            # El registro existe pero su versión en BD difiere de la enviada
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "CONFLICTO_CONCURRENCIA",
                    "mensaje": (
                        f"El deportista fue modificado por otro usuario (versión actual: {actual['version']}, "
                        f"versión recibida: {req.version}). Por favor recargue la información antes de guardar."
                    ),
                },
            )

        # Auditoría
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="EDITAR",
            entidad="deportistas",
            entidad_id=str(deportista_id),
            detalle={"version_previa": req.version, "nueva_version": row["version"]},
        )

        return DeportistaResponse(**row)

    # =====================================================================
    # 6. Cambiar Estado Operativo (Activar / Desactivar)
    # =====================================================================
    @classmethod
    async def cambiar_estado(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        deportista_id: UUID,
        req: CambiarEstadoDeportistaRequest,
    ) -> DeportistaResponse:
        """Activa o desactiva operativamente a un deportista."""
        now_utc = datetime.now(timezone.utc)
        update_query = text("""
            UPDATE platform.deportistas
            SET activo = :activo,
                version = version + 1,
                updated_at = :now_utc
            WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL
            RETURNING id, gimnasio_id, documento, nombre, correo, telefono,
                      sexo, fecha_nacimiento, altura_cm,
                      consentimiento_1581, consentimiento_fecha,
                      acudiente_nombre, activo, version, created_at, updated_at;
        """)
        res = await session.execute(
            update_query,
            {"id": deportista_id, "gym_id": gym_id, "activo": req.activo, "now_utc": now_utc},
        )
        row = res.mappings().one_or_none()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado."},
            )

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CAMBIAR_ESTADO",
            entidad="deportistas",
            entidad_id=str(deportista_id),
            detalle={"activo": req.activo},
        )

        return DeportistaResponse(**row)

    # =====================================================================
    # 7. Invitación App Móvil (RF-18)
    # =====================================================================
    @classmethod
    async def generar_invitacion_app(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        deportista_id: UUID,
    ) -> InvitacionAppResponse:
        """
        Genera o regenera un código seguro y enlace de activación para la app.
        La app es opcional (RF-18).
        """
        # 1. Validar correo del deportista
        dep_query = text("""
            SELECT correo FROM platform.deportistas
            WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL;
        """)
        res_dep = await session.execute(dep_query, {"id": deportista_id, "gym_id": gym_id})
        row_dep = res_dep.mappings().one_or_none()
        if not row_dep:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado."},
            )
        if not row_dep["correo"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "codigo": "CORREO_REQUERIDO_PARA_APP",
                    "mensaje": "El deportista debe tener un correo registrado para generar la invitación de la app.",
                },
            )

        # 2. Validar que no tenga ya una cuenta activa
        cta_query = text("""
            SELECT 1 FROM platform.cuentas_app
            WHERE deportista_id = :id AND gimnasio_id = :gym_id AND activa = true;
        """)
        res_cta = await session.execute(cta_query, {"id": deportista_id, "gym_id": gym_id})
        if res_cta.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "CUENTA_APP_YA_ACTIVADA", "mensaje": "El deportista ya tiene una cuenta activa en la app."},
            )

        # 3. Obtener subdominio del gimnasio para construir enlace
        sub_query = text("SELECT subdominio FROM platform.tenant WHERE id = :gym_id;")
        res_sub = await session.execute(sub_query, {"gym_id": gym_id})
        subdominio = res_sub.scalar_one()

        # 4. Expirar invitaciones pendientes anteriores
        expire_prev = text("""
            UPDATE platform.invitaciones_app
            SET estado = 'expirada'
            WHERE deportista_id = :id AND gimnasio_id = :gym_id AND estado = 'pendiente';
        """)
        await session.execute(expire_prev, {"id": deportista_id, "gym_id": gym_id})

        # 5. Generar código alfanumérico seguro de 8 caracteres
        codigo_plano = secrets.token_hex(4).upper()
        codigo_hash = hash_token(codigo_plano)
        expira_en = datetime.now(timezone.utc) + timedelta(days=7)

        insert_inv = text("""
            INSERT INTO platform.invitaciones_app (
                gimnasio_id, deportista_id, codigo_hash, estado, expira_en, created_at
            ) VALUES (
                :gym_id, :id, :codigo_hash, 'pendiente', :expira_en, now()
            );
        """)
        await session.execute(
            insert_inv,
            {
                "gym_id": gym_id,
                "id": deportista_id,
                "codigo_hash": codigo_hash,
                "expira_en": expira_en,
            },
        )

        enlace = f"https://{subdominio}.gymos.co/activar-app?codigo={codigo_plano}"

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="GENERAR_INVITACION_APP",
            entidad="invitaciones_app",
            entidad_id=str(deportista_id),
            detalle={"expira_en": expira_en.isoformat()},
        )

        return InvitacionAppResponse(
            deportista_id=deportista_id,
            codigo=codigo_plano,
            enlace_activacion=enlace,
            expira_en=expira_en,
        )

    # =====================================================================
    # 8. Mediciones Corporales (RF-21)
    # =====================================================================
    @classmethod
    async def listar_mediciones(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        deportista_id: UUID,
    ) -> List[MedicionCorporalResponse]:
        """Consulta historial cronológico de valoraciones físicas."""
        # Verificar existencia del deportista
        dep_check = text("SELECT 1 FROM platform.deportistas WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL;")
        res_check = await session.execute(dep_check, {"id": deportista_id, "gym_id": gym_id})
        if not res_check.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado."},
            )

        query = text("""
            SELECT mc.id, mc.fecha, mc.peso, mc.grasa_pct, mc.masa_muscular,
                   mc.cintura, mc.cadera, mc.brazo, mc.pierna, mc.pecho,
                   mc.registrado_por, s.nombre AS registrado_por_nombre, mc.created_at
            FROM platform.mediciones_corporales mc
            LEFT JOIN platform.staff s ON s.id = mc.registrado_por
            WHERE mc.deportista_id = :id AND mc.gimnasio_id = :gym_id
            ORDER BY mc.fecha DESC, mc.created_at DESC;
        """)
        res = await session.execute(query, {"id": deportista_id, "gym_id": gym_id})
        return [MedicionCorporalResponse(**r) for r in res.mappings().all()]

    @classmethod
    async def registrar_medicion(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        deportista_id: UUID,
        req: RegistrarMedicionRequest,
    ) -> MedicionCorporalResponse:
        """Registra una nueva medición corporal antropométrica."""
        # Verificar existencia
        dep_check = text("SELECT 1 FROM platform.deportistas WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL;")
        res_check = await session.execute(dep_check, {"id": deportista_id, "gym_id": gym_id})
        if not res_check.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado."},
            )

        fecha_toma = req.fecha or cls._obtener_fecha_hoy_bogota()

        insert_query = text("""
            INSERT INTO platform.mediciones_corporales (
                gimnasio_id, deportista_id, fecha, peso, grasa_pct, masa_muscular,
                cintura, cadera, brazo, pierna, pecho, registrado_por, created_at
            ) VALUES (
                :gym_id, :id, :fecha, :peso, :grasa_pct, :masa_muscular,
                :cintura, :cadera, :brazo, :pierna, :pecho, :staff_id, now()
            )
            RETURNING id, fecha, peso, grasa_pct, masa_muscular,
                      cintura, cadera, brazo, pierna, pecho,
                      registrado_por, created_at;
        """)

        res = await session.execute(
            insert_query,
            {
                "gym_id": gym_id,
                "id": deportista_id,
                "fecha": fecha_toma,
                "peso": req.peso,
                "grasa_pct": req.grasa_pct,
                "masa_muscular": req.masa_muscular,
                "cintura": req.cintura,
                "cadera": req.cadera,
                "brazo": req.brazo,
                "pierna": req.pierna,
                "pecho": req.pecho,
                "staff_id": staff_id,
            },
        )
        row = dict(res.mappings().one())
        row["registrado_por_nombre"] = staff_nombre

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="REGISTRAR_MEDICION",
            entidad="mediciones_corporales",
            entidad_id=str(row["id"]),
            detalle={"deportista_id": str(deportista_id), "fecha": fecha_toma.isoformat()},
        )

        return MedicionCorporalResponse(**row)

    # =====================================================================
    # 9. Biometría de Huellas (RF-22, RNF-01)
    # =====================================================================
    @classmethod
    async def enrolar_huella(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        deportista_id: UUID,
        req: EnrolarHuellaRequest,
    ) -> HuellaInfoResponse:
        """
        Enrola o re-registra la plantilla biométrica dactilar de un dedo.
        Cifra en servidor con AES-256-GCM. El template cifrado nunca se expone en la API.
        """
        # 1. Verificar existencia del deportista
        dep_check = text("SELECT 1 FROM platform.deportistas WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL;")
        res_check = await session.execute(dep_check, {"id": deportista_id, "gym_id": gym_id})
        if not res_check.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado."},
            )

        # 2. Decodificar Base64
        try:
            template_bytes = base64.b64decode(req.template_base64)
            if not template_bytes:
                raise ValueError("Template vacío")
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "TEMPLATE_INVALIDO", "mensaje": "El template biométrico no es un Base64 válido."},
            )

        # 3. Cifrar con AES-256-GCM (genera nonce de 12 bytes por registro)
        payload_cifrado = encrypt_biometric_template(template_bytes)

        # 4. UPSERT en platform.huellas
        upsert_query = text("""
            INSERT INTO platform.huellas (
                gimnasio_id, deportista_id, dedo, template_cifrado, created_at
            ) VALUES (
                :gym_id, :id, :dedo, :cifrado, now()
            )
            ON CONFLICT (deportista_id, dedo) DO UPDATE
            SET template_cifrado = EXCLUDED.template_cifrado,
                created_at = now()
            RETURNING id, dedo, created_at;
        """)

        res = await session.execute(
            upsert_query,
            {
                "gym_id": gym_id,
                "id": deportista_id,
                "dedo": req.dedo,
                "cifrado": payload_cifrado,
            },
        )
        row = res.mappings().one()

        # 5. Auditoría sin volcar datos biométricos
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="ENROLAR_HUELLA",
            entidad="huellas",
            entidad_id=str(row["id"]),
            detalle={"deportista_id": str(deportista_id), "dedo": req.dedo},
        )

        return HuellaInfoResponse(**row)

    @classmethod
    async def eliminar_huella(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        deportista_id: UUID,
        dedo: str,
    ) -> Dict[str, Any]:
        """Elimina físicamente la plantilla biométrica de un dedo."""
        dedo_clean = dedo.strip().lower()
        del_query = text("""
            DELETE FROM platform.huellas
            WHERE gimnasio_id = :gym_id AND deportista_id = :id AND dedo = :dedo
            RETURNING id;
        """)
        res = await session.execute(del_query, {"gym_id": gym_id, "id": deportista_id, "dedo": dedo_clean})
        deleted_id = res.scalar_one_or_none()
        if not deleted_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "HUELLA_NO_ENCONTRADA", "mensaje": f"No existe huella enrolada para el dedo '{dedo_clean}'."},
            )

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="ELIMINAR_HUELLA",
            entidad="huellas",
            entidad_id=str(deleted_id),
            detalle={"deportista_id": str(deportista_id), "dedo": dedo_clean},
        )

        return {"mensaje": "Plantilla biométrica eliminada exitosamente.", "dedo": dedo_clean}

    # =====================================================================
    # 10. Supresión de Datos / Derecho al Olvido (RF-23, Ley 1581)
    # =====================================================================
    @classmethod
    async def suprimir_datos_ley_1581(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        deportista_id: UUID,
        req: SuprimirDatosRequest,
    ) -> Dict[str, Any]:
        """
        Ejecuta el derecho al olvido conforme a la Ley 1581 de 2012:
        1. Borrado físico de huellas, credenciales móviles y valoraciones de salud.
        2. Anonimización irreversible del perfil del deportista (libera cédula para futuros registros).
        3. Conservación de asientos contables (ventas, pagos de membresía) para retención fiscal (5 años).
        4. Auditoría inmutable en platform.auditoria_gym.
        """
        # Verificar existencia
        dep_query = text("""
            SELECT id, documento, nombre
            FROM platform.deportistas
            WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL;
        """)
        res_dep = await session.execute(dep_query, {"id": deportista_id, "gym_id": gym_id})
        dep_row = res_dep.mappings().one_or_none()
        if not dep_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado o ya fue suprimido."},
            )

        # NIVEL 1: Borrado Físico Literal
        # 1. Huellas biométricas
        await session.execute(
            text("DELETE FROM platform.huellas WHERE gimnasio_id = :gym_id AND deportista_id = :id;"),
            {"gym_id": gym_id, "id": deportista_id},
        )
        # 2. Credenciales y tokens de la App
        await session.execute(
            text("DELETE FROM platform.cuentas_app WHERE gimnasio_id = :gym_id AND deportista_id = :id;"),
            {"gym_id": gym_id, "id": deportista_id},
        )
        await session.execute(
            text("DELETE FROM platform.invitaciones_app WHERE gimnasio_id = :gym_id AND deportista_id = :id;"),
            {"gym_id": gym_id, "id": deportista_id},
        )
        # 3. Mediciones corporales y rutinas asignadas/personalizadas
        await session.execute(
            text("DELETE FROM platform.mediciones_corporales WHERE gimnasio_id = :gym_id AND deportista_id = :id;"),
            {"gym_id": gym_id, "id": deportista_id},
        )
        await session.execute(
            text("DELETE FROM platform.rutinas_asignadas WHERE gimnasio_id = :gym_id AND deportista_id = :id;"),
            {"gym_id": gym_id, "id": deportista_id},
        )

        # Tablas adicionales de gamificación o entrenamiento (si existen registros)
        for tbl in [
            "cuestionario_experiencia",
            "rutinas_personalizadas",
            "sesiones_entrenamiento",
            "rachas",
            "logros_obtenidos",
            "calificaciones_entrenador",
            "calificaciones_clase",
            "asistencia_clase",
            "reservas_clase",
        ]:
            await session.execute(
                text(f"DELETE FROM platform.{tbl} WHERE deportista_id = :id;"),
                {"id": deportista_id},
            )

        # NIVEL 2: Anonimización Irreversible en platform.deportistas
        now_utc = datetime.now(timezone.utc)
        anon_query = text("""
            UPDATE platform.deportistas
            SET nombre = 'DEPORTISTA SUPRIMIDO (LEY 1581)',
                documento = 'ANON-' || gen_random_uuid(),
                correo = NULL,
                telefono = NULL,
                acudiente_nombre = NULL,
                sexo = NULL,
                fecha_nacimiento = NULL,
                altura_cm = NULL,
                activo = false,
                deleted_at = :now_utc,
                updated_at = :now_utc
            WHERE id = :id AND gimnasio_id = :gym_id;
        """)
        await session.execute(anon_query, {"id": deportista_id, "gym_id": gym_id, "now_utc": now_utc})

        # Cancelar membresías activas sin borrarlas (preserva relación contable con pagos_membresia)
        await session.execute(
            text("UPDATE platform.membresias SET cancelada = true, updated_at = :now_utc WHERE deportista_id = :id AND gimnasio_id = :gym_id;"),
            {"id": deportista_id, "gym_id": gym_id, "now_utc": now_utc},
        )

        # NIVEL 3: Auditoría inmutable en platform.auditoria_gym
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="SUPRESION_DATOS_LEY_1581",
            entidad="deportistas",
            entidad_id=str(deportista_id),
            detalle={"motivo": req.motivo},
        )

        return {
            "mensaje": "Datos personales y biométricos suprimidos exitosamente conforme a la Ley 1581.",
            "deportista_id": str(deportista_id),
        }
