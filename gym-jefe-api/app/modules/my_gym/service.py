"""
Servicio de negocio para el Módulo 11: MyGymOS (Configuración del Gimnasio, RF-45 a RF-50).
Implementa:
- Información general y sede (RF-45)
- Mi landing y código QR generado en memoria (RF-46)
- Métodos de pago aceptados (RF-47)
- Parámetros por gimnasio con efecto inmediato y validación de rangos (RF-48)
- Registro y consulta de auditoría inmutable exclusiva para el Jefe con filtros y paginación (RF-49, RF-50)
- Control de Concurrencia Optimista (OCC) con version en todas las mutaciones
"""
import io
import json
import math
from datetime import date
from typing import Any, Dict, List, Optional
from uuid import UUID

import qrcode
import qrcode.image.svg
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.dependencies import AuthenticatedStaff
from app.core.timezone import get_local_day_range_utc
from app.modules.my_gym.schemas import (
    ActualizarBrandingRequest,
    ActualizarInfoGymRequest,
    ActualizarMetodosPagoRequest,
    ActualizarParametrosRequest,
    AuditoriaFiltrosDisponiblesResponse,
    AuditoriaGymItemResponse,
    AuditoriaPaginadaResponse,
    InfoGymResponse,
    LandingInfoResponse,
    ParametrosTenantResponse,
)


class MyGymService:
    """Lógica de negocio y persistencia para la configuración y auditoría del gimnasio."""

    # --------------------------------------------------------------------------
    # RF-45, RF-47, RF-48: INFORMACIÓN Y PARÁMETROS DEL TENANT
    # --------------------------------------------------------------------------

    @staticmethod
    def _parse_json_field(val: Any, default: Any) -> Any:
        if val is None:
            return default
        if isinstance(val, (dict, list)):
            return val
        if isinstance(val, str):
            try:
                return json.loads(val)
            except Exception:
                return default
        return default

    @classmethod
    async def obtener_info(
        cls,
        session: AsyncSession,
        gimnasio_id: UUID
    ) -> InfoGymResponse:
        """Obtiene la configuración integral del gimnasio."""
        stmt = text("""
            SELECT id, nombre, subdominio, zona_horaria, direccion, ciudad,
                   telefono, correo, redes, horarios, metodos_pago,
                   dias_gracia_mora, tope_dias_congelamiento, dias_umbral_por_vencer,
                   branding, version, activo, updated_at
            FROM platform.tenant
            WHERE id = :gym_id
        """)
        res = await session.execute(stmt, {"gym_id": gimnasio_id})
        row = res.mappings().first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "TENANT_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado."}
            )

        return InfoGymResponse(
            id=row["id"],
            nombre=row["nombre"],
            subdominio=row["subdominio"],
            zona_horaria=row["zona_horaria"],
            direccion=row["direccion"],
            ciudad=row["ciudad"],
            telefono=row["telefono"],
            correo=row["correo"],
            redes=cls._parse_json_field(row["redes"], {}),
            horarios=cls._parse_json_field(row["horarios"], None),
            metodos_pago=cls._parse_json_field(row["metodos_pago"], []),
            dias_gracia_mora=row["dias_gracia_mora"],
            tope_dias_congelamiento=row["tope_dias_congelamiento"],
            dias_umbral_por_vencer=row["dias_umbral_por_vencer"],
            branding=cls._parse_json_field(row["branding"], {}),
            version=row["version"],
            activo=row["activo"],
            updated_at=row["updated_at"]
        )

    @classmethod
    async def actualizar_info(
        cls,
        session: AsyncSession,
        gimnasio_id: UUID,
        data: ActualizarInfoGymRequest,
        current_staff: AuthenticatedStaff
    ) -> InfoGymResponse:
        """
        RF-45: Actualiza la información general, contacto, redes y horarios de la sede.
        Aplica control de concurrencia optimista (OCC) con version.
        """
        redes_json = json.dumps(data.redes or {})
        horarios_json = json.dumps(data.horarios) if data.horarios is not None else None

        update_stmt = text("""
            UPDATE platform.tenant
            SET nombre = :nombre,
                direccion = :direccion,
                ciudad = :ciudad,
                telefono = :telefono,
                correo = :correo,
                redes = CAST(:redes AS jsonb),
                horarios = CAST(:horarios AS jsonb),
                version = version + 1,
                updated_at = now()
            WHERE id = :gym_id AND version = :version_esperada
            RETURNING id, nombre, subdominio, zona_horaria, direccion, ciudad,
                      telefono, correo, redes, horarios, metodos_pago,
                      dias_gracia_mora, tope_dias_congelamiento, dias_umbral_por_vencer,
                      branding, version, activo, updated_at
        """)

        res = await session.execute(update_stmt, {
            "gym_id": gimnasio_id,
            "version_esperada": data.version,
            "nombre": data.nombre,
            "direccion": data.direccion,
            "ciudad": data.ciudad,
            "telefono": data.telefono,
            "correo": str(data.correo) if data.correo else None,
            "redes": redes_json,
            "horarios": horarios_json
        })
        row = res.mappings().first()

        if not row:
            # Validar si el tenant existe para distinguir 404 de 409
            check = await session.execute(
                text("SELECT version FROM platform.tenant WHERE id = :gym_id"),
                {"gym_id": gimnasio_id}
            )
            current_ver = check.scalar()
            if current_ver is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "TENANT_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado."}
                )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "CONFLICTO_CONCURRENCIA",
                    "mensaje": (
                        f"La información del gimnasio fue modificada por otro usuario (versión actual: {current_ver}, "
                        f"versión enviada: {data.version}). Por favor recargue y reintente."
                    )
                }
            )

        # Auditoría inmutable de la acción
        await AuditService.registrar(
            session=session,
            gimnasio_id=gimnasio_id,
            actor_id=current_staff.id,
            actor_nombre=current_staff.nombre,
            accion="actualizar_info_general",
            entidad="tenant",
            entidad_id=str(gimnasio_id),
            detalle={
                "nombre": data.nombre,
                "direccion": data.direccion,
                "ciudad": data.ciudad,
                "telefono": data.telefono,
                "correo": str(data.correo) if data.correo else None,
                "version_anterior": data.version,
                "version_nueva": row["version"]
            }
        )

        return InfoGymResponse(
            id=row["id"],
            nombre=row["nombre"],
            subdominio=row["subdominio"],
            zona_horaria=row["zona_horaria"],
            direccion=row["direccion"],
            ciudad=row["ciudad"],
            telefono=row["telefono"],
            correo=row["correo"],
            redes=cls._parse_json_field(row["redes"], {}),
            horarios=cls._parse_json_field(row["horarios"], None),
            metodos_pago=cls._parse_json_field(row["metodos_pago"], []),
            dias_gracia_mora=row["dias_gracia_mora"],
            tope_dias_congelamiento=row["tope_dias_congelamiento"],
            dias_umbral_por_vencer=row["dias_umbral_por_vencer"],
            branding=cls._parse_json_field(row["branding"], {}),
            version=row["version"],
            activo=row["activo"],
            updated_at=row["updated_at"]
        )

    @classmethod
    async def actualizar_parametros(
        cls,
        session: AsyncSession,
        gimnasio_id: UUID,
        data: ActualizarParametrosRequest,
        current_staff: AuthenticatedStaff
    ) -> ParametrosTenantResponse:
        """
        RF-48: Actualiza parámetros operativos del tenant (gracia mora, congelamiento, umbral vencer).
        Tiene efecto inmediato en los módulos de Control de Ingreso, Membresías y Reportes.
        Aplica control de concurrencia optimista (OCC) con version.
        """
        update_stmt = text("""
            UPDATE platform.tenant
            SET dias_gracia_mora = :dias_gracia,
                tope_dias_congelamiento = :tope_congelamiento,
                dias_umbral_por_vencer = :dias_umbral,
                version = version + 1,
                updated_at = now()
            WHERE id = :gym_id AND version = :version_esperada
            RETURNING dias_gracia_mora, tope_dias_congelamiento, dias_umbral_por_vencer, version
        """)

        res = await session.execute(update_stmt, {
            "gym_id": gimnasio_id,
            "version_esperada": data.version,
            "dias_gracia": data.dias_gracia_mora,
            "tope_congelamiento": data.tope_dias_congelamiento,
            "dias_umbral": data.dias_umbral_por_vencer
        })
        row = res.mappings().first()

        if not row:
            check = await session.execute(
                text("SELECT version FROM platform.tenant WHERE id = :gym_id"),
                {"gym_id": gimnasio_id}
            )
            current_ver = check.scalar()
            if current_ver is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "TENANT_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado."}
                )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "CONFLICTO_CONCURRENCIA",
                    "mensaje": (
                        f"Los parámetros fueron modificados por otro usuario (versión actual: {current_ver}, "
                        f"versión enviada: {data.version}). Por favor recargue y reintente."
                    )
                }
            )

        # Auditoría inmutable de cambio de políticas de negocio
        await AuditService.registrar(
            session=session,
            gimnasio_id=gimnasio_id,
            actor_id=current_staff.id,
            actor_nombre=current_staff.nombre,
            accion="actualizar_parametros_tenant",
            entidad="tenant",
            entidad_id=str(gimnasio_id),
            detalle={
                "dias_gracia_mora": data.dias_gracia_mora,
                "tope_dias_congelamiento": data.tope_dias_congelamiento,
                "dias_umbral_por_vencer": data.dias_umbral_por_vencer,
                "version_anterior": data.version,
                "version_nueva": row["version"]
            }
        )

        return ParametrosTenantResponse(
            dias_gracia_mora=row["dias_gracia_mora"],
            tope_dias_congelamiento=row["tope_dias_congelamiento"],
            dias_umbral_por_vencer=row["dias_umbral_por_vencer"],
            version=row["version"]
        )

    @classmethod
    async def actualizar_metodos_pago(
        cls,
        session: AsyncSession,
        gimnasio_id: UUID,
        data: ActualizarMetodosPagoRequest,
        current_staff: AuthenticatedStaff
    ) -> InfoGymResponse:
        """
        RF-47: Configura los métodos de pago aceptados en caja por el gimnasio.
        Aplica OCC con version.
        """
        metodos_limpios = [m.strip().lower() for m in data.metodos_pago if m.strip()]
        if not metodos_limpios:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"codigo": "METODOS_PAGO_INVALIDOS", "mensaje": "Debe especificar al menos un método de pago."}
            )

        update_stmt = text("""
            UPDATE platform.tenant
            SET metodos_pago = CAST(:metodos_pago AS jsonb),
                version = version + 1,
                updated_at = now()
            WHERE id = :gym_id AND version = :version_esperada
            RETURNING id, nombre, subdominio, zona_horaria, direccion, ciudad,
                      telefono, correo, redes, horarios, metodos_pago,
                      dias_gracia_mora, tope_dias_congelamiento, dias_umbral_por_vencer,
                      branding, version, activo, updated_at
        """)

        res = await session.execute(update_stmt, {
            "gym_id": gimnasio_id,
            "version_esperada": data.version,
            "metodos_pago": json.dumps(metodos_limpios)
        })
        row = res.mappings().first()

        if not row:
            check = await session.execute(
                text("SELECT version FROM platform.tenant WHERE id = :gym_id"),
                {"gym_id": gimnasio_id}
            )
            current_ver = check.scalar()
            if current_ver is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "TENANT_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado."}
                )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "CONFLICTO_CONCURRENCIA",
                    "mensaje": "Los métodos de pago fueron modificados por otro usuario. Por favor recargue y reintente."
                }
            )

        # Auditoría inmutable
        await AuditService.registrar(
            session=session,
            gimnasio_id=gimnasio_id,
            actor_id=current_staff.id,
            actor_nombre=current_staff.nombre,
            accion="actualizar_metodos_pago",
            entidad="tenant",
            entidad_id=str(gimnasio_id),
            detalle={
                "metodos_pago": metodos_limpios,
                "version_anterior": data.version,
                "version_nueva": row["version"]
            }
        )

        return InfoGymResponse(
            id=row["id"],
            nombre=row["nombre"],
            subdominio=row["subdominio"],
            zona_horaria=row["zona_horaria"],
            direccion=row["direccion"],
            ciudad=row["ciudad"],
            telefono=row["telefono"],
            correo=row["correo"],
            redes=cls._parse_json_field(row["redes"], {}),
            horarios=cls._parse_json_field(row["horarios"], None),
            metodos_pago=cls._parse_json_field(row["metodos_pago"], []),
            dias_gracia_mora=row["dias_gracia_mora"],
            tope_dias_congelamiento=row["tope_dias_congelamiento"],
            dias_umbral_por_vencer=row["dias_umbral_por_vencer"],
            branding=cls._parse_json_field(row["branding"], {}),
            version=row["version"],
            activo=row["activo"],
            updated_at=row["updated_at"]
        )

    @classmethod
    async def actualizar_branding(
        cls,
        session: AsyncSession,
        gimnasio_id: UUID,
        data: ActualizarBrandingRequest,
        current_staff: AuthenticatedStaff
    ) -> InfoGymResponse:
        """Actualiza tokens de identidad visual y colores corporativos con OCC."""
        # Obtener branding actual para merge inteligente
        curr_res = await session.execute(
            text("SELECT branding, version FROM platform.tenant WHERE id = :gym_id"),
            {"gym_id": gimnasio_id}
        )
        curr_row = curr_res.mappings().first()
        if not curr_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "TENANT_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado."}
            )

        current_branding = cls._parse_json_field(curr_row["branding"], {})
        if data.primary_color is not None:
            current_branding["primary_color"] = data.primary_color
        if data.secondary_color is not None:
            current_branding["secondary_color"] = data.secondary_color
        if data.accent_color is not None:
            current_branding["accent_color"] = data.accent_color
        if data.logo_url is not None:
            current_branding["logo_url"] = data.logo_url
        if data.banner_url is not None:
            current_branding["banner_url"] = data.banner_url

        update_stmt = text("""
            UPDATE platform.tenant
            SET branding = CAST(:branding AS jsonb),
                version = version + 1,
                updated_at = now()
            WHERE id = :gym_id AND version = :version_esperada
            RETURNING id, nombre, subdominio, zona_horaria, direccion, ciudad,
                      telefono, correo, redes, horarios, metodos_pago,
                      dias_gracia_mora, tope_dias_congelamiento, dias_umbral_por_vencer,
                      branding, version, activo, updated_at
        """)

        res = await session.execute(update_stmt, {
            "gym_id": gimnasio_id,
            "version_esperada": data.version,
            "branding": json.dumps(current_branding)
        })
        row = res.mappings().first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "CONFLICTO_CONCURRENCIA",
                    "mensaje": "La identidad visual fue modificada por otro usuario. Por favor recargue y reintente."
                }
            )

        # Auditoría inmutable
        await AuditService.registrar(
            session=session,
            gimnasio_id=gimnasio_id,
            actor_id=current_staff.id,
            actor_nombre=current_staff.nombre,
            accion="actualizar_branding",
            entidad="tenant",
            entidad_id=str(gimnasio_id),
            detalle={
                "branding": current_branding,
                "version_anterior": data.version,
                "version_nueva": row["version"]
            }
        )

        return InfoGymResponse(
            id=row["id"],
            nombre=row["nombre"],
            subdominio=row["subdominio"],
            zona_horaria=row["zona_horaria"],
            direccion=row["direccion"],
            ciudad=row["ciudad"],
            telefono=row["telefono"],
            correo=row["correo"],
            redes=cls._parse_json_field(row["redes"], {}),
            horarios=cls._parse_json_field(row["horarios"], None),
            metodos_pago=cls._parse_json_field(row["metodos_pago"], []),
            dias_gracia_mora=row["dias_gracia_mora"],
            tope_dias_congelamiento=row["tope_dias_congelamiento"],
            dias_umbral_por_vencer=row["dias_umbral_por_vencer"],
            branding=cls._parse_json_field(row["branding"], {}),
            version=row["version"],
            activo=row["activo"],
            updated_at=row["updated_at"]
        )

    # --------------------------------------------------------------------------
    # RF-46: MI LANDING Y QR (SOLO LECTURA)
    # --------------------------------------------------------------------------

    @classmethod
    async def _construir_landing_url(
        cls,
        session: AsyncSession,
        gimnasio_id: UUID
    ) -> tuple[str, Optional[str], str]:
        """Helper para resolver la URL canónica de la landing del tenant."""
        stmt = text("SELECT subdominio, landing_slug FROM platform.tenant WHERE id = :gym_id")
        res = await session.execute(stmt, {"gym_id": gimnasio_id})
        row = res.mappings().first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "TENANT_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado."}
            )

        subdominio = row["subdominio"]
        landing_slug = row["landing_slug"]
        if landing_slug:
            landing_url = f"https://gymos.io/gym/{landing_slug}"
        else:
            landing_url = f"https://{subdominio}.gymos.io"

        return subdominio, landing_slug, landing_url

    @classmethod
    async def obtener_landing(
        cls,
        session: AsyncSession,
        gimnasio_id: UUID
    ) -> LandingInfoResponse:
        """
        RF-46: Consulta enlace público y código QR en formato SVG puro generado en memoria.
        Solo lectura estricta.
        """
        subdominio, landing_slug, landing_url = await cls._construir_landing_url(session, gimnasio_id)

        # Generación de QR en formato SVG en memoria (Zero-Disk I/O)
        qr = qrcode.QRCode(version=1, box_size=10, border=2)
        qr.add_data(landing_url)
        qr.make(fit=True)
        img = qr.make_image(image_factory=qrcode.image.svg.SvgPathImage)

        buf = io.BytesIO()
        img.save(buf)
        svg_content = buf.getvalue().decode("utf-8")

        return LandingInfoResponse(
            subdominio=subdominio,
            landing_slug=landing_slug,
            landing_url=landing_url,
            qr_data=landing_url,
            qr_svg=svg_content,
            es_solo_lectura=True
        )

    @classmethod
    async def generar_qr_png_bytes(
        cls,
        session: AsyncSession,
        gimnasio_id: UUID
    ) -> bytes:
        """Genera imagen binaria PNG del código QR directamente en memoria para descarga."""
        _, _, landing_url = await cls._construir_landing_url(session, gimnasio_id)

        qr = qrcode.QRCode(version=1, box_size=10, border=2)
        qr.add_data(landing_url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="black", back_color="white")

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    # --------------------------------------------------------------------------
    # RF-49 & RF-50: AUDITORÍA CON FILTROS (SOLO JEFE)
    # --------------------------------------------------------------------------

    @classmethod
    async def consultar_auditoria(
        cls,
        session: AsyncSession,
        gimnasio_id: UUID,
        fecha_inicio: Optional[date] = None,
        fecha_fin: Optional[date] = None,
        actor_id: Optional[UUID] = None,
        accion: Optional[str] = None,
        entidad: Optional[str] = None,
        q: Optional[str] = None,
        page: int = 1,
        page_size: int = 50
    ) -> AuditoriaPaginadaResponse:
        """
        RF-49, RF-50: Feed de auditoría inmutable append-only con hash-chain.
        Visible exclusivamente para el Jefe.
        Optimizado con índices B-Tree compuestos sobre platform.auditoria_gym.
        """
        # 1. Construir condiciones WHERE con gimnasio_id obligatorio
        condiciones = ["gimnasio_id = :gym_id"]
        params: Dict[str, Any] = {"gym_id": gimnasio_id}

        # Filtro de fechas respetando America/Bogota (RNF-08)
        if fecha_inicio or fecha_fin:
            start_utc, end_utc = get_local_day_range_utc(fecha_inicio, fecha_fin)
            condiciones.append("created_at >= :start_utc AND created_at <= :end_utc")
            params["start_utc"] = start_utc
            params["end_utc"] = end_utc

        if actor_id is not None:
            condiciones.append("actor_id = :actor_id")
            params["actor_id"] = actor_id

        if accion:
            condiciones.append("accion = :accion")
            params["accion"] = accion.strip()

        if entidad:
            condiciones.append("entidad = :entidad")
            params["entidad"] = entidad.strip()

        if q:
            condiciones.append("(actor_nombre ILIKE :q_like OR entidad_id ILIKE :q_like OR accion ILIKE :q_like)")
            params["q_like"] = f"%{q.strip()}%"

        where_clause = " AND ".join(condiciones)

        # 2. Conteo total para paginación
        count_query = text(f"SELECT count(*) FROM platform.auditoria_gym WHERE {where_clause}")
        total_res = await session.execute(count_query, params)
        total_count = total_res.scalar() or 0

        # 3. Consulta paginada ordenada por created_at DESC (aprovecha ix_audgym_gym_*)
        offset = (page - 1) * page_size
        params["limit"] = page_size
        params["offset"] = offset

        data_query = text(f"""
            SELECT id, created_at, actor_id, actor_nombre, impersonando,
                   accion, entidad, entidad_id, detalle, hash_previo, hash_actual
            FROM platform.auditoria_gym
            WHERE {where_clause}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """)

        data_res = await session.execute(data_query, params)
        rows = data_res.mappings().all()

        items = [
            AuditoriaGymItemResponse(
                id=r["id"],
                created_at=r["created_at"],
                actor_id=r["actor_id"],
                actor_nombre=r["actor_nombre"],
                impersonando=r["impersonando"],
                accion=r["accion"],
                entidad=r["entidad"],
                entidad_id=r["entidad_id"],
                detalle=cls._parse_json_field(r["detalle"], None),
                hash_previo=r["hash_previo"],
                hash_actual=r["hash_actual"]
            )
            for r in rows
        ]

        total_pages = math.ceil(total_count / page_size) if total_count > 0 else 0

        return AuditoriaPaginadaResponse(
            items=items,
            total=total_count,
            page=page,
            page_size=page_size,
            total_pages=total_pages
        )

    @classmethod
    async def obtener_filtros_disponibles(
        cls,
        session: AsyncSession,
        gimnasio_id: UUID
    ) -> AuditoriaFiltrosDisponiblesResponse:
        """
        RF-50: Retorna listas únicas de acciones y entidades registradas
        para el tenant para alimentar los selectores de filtros del frontend.
        """
        acciones_query = text("""
            SELECT DISTINCT accion 
            FROM platform.auditoria_gym 
            WHERE gimnasio_id = :gym_id 
            ORDER BY accion
        """)
        acciones_res = await session.execute(acciones_query, {"gym_id": gimnasio_id})
        acciones = [r[0] for r in acciones_res.fetchall()]

        entidades_query = text("""
            SELECT DISTINCT entidad 
            FROM platform.auditoria_gym 
            WHERE gimnasio_id = :gym_id 
            ORDER BY entidad
        """)
        entidades_res = await session.execute(entidades_query, {"gym_id": gimnasio_id})
        entidades = [r[0] for r in entidades_res.fetchall()]

        return AuditoriaFiltrosDisponiblesResponse(
            acciones=acciones,
            entidades=entidades
        )
