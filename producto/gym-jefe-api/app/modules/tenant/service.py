import json
from typing import Any, Dict
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contexto_gimnasio import fijar_gimnasio
from app.core.dependencies import verificar_suscripcion_operativa
from app.modules.tenant.schemas import (
    ResolverTenantResponse,
    TenantThemeResponse,
)


class TenantService:
    @staticmethod
    def _parsear_branding(branding_raw: Any) -> Dict[str, Any]:
        if isinstance(branding_raw, dict):
            return branding_raw
        if isinstance(branding_raw, str):
            try:
                return json.loads(branding_raw)
            except Exception:
                return {}
        return {}

    @classmethod
    async def obtener_tema(
        cls,
        session: AsyncSession,
        gym_id: UUID,
    ) -> TenantThemeResponse:
        """
        Retorna la configuración de marca del gimnasio para Dynamic White-Labeling (Sección 4.3).
        Asegura el contexto RLS SET LOCAL app.current_tenant_id.
        """
        await fijar_gimnasio(session, gym_id)
        await session.execute(
            text("SELECT set_config('app.current_tenant_id', :gym_id, true)"),
            {"gym_id": str(gym_id)},
        )

        query = text("""
            SELECT id, nombre, subdominio, branding, activo
            FROM platform.tenant
            WHERE id = :gym_id
        """)
        res = await session.execute(query, {"gym_id": gym_id})
        row = res.mappings().first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "TENANT_NO_ENCONTRADO", "mensaje": "Gimnasio no encontrado"},
            )
        if not row["activo"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"codigo": "GIMNASIO_SUSPENDIDO", "mensaje": "El servicio del gimnasio no está disponible"},
            )

        branding = cls._parsear_branding(row["branding"])
        app_movil_activa = branding.get("app_movil_activa", True)

        return TenantThemeResponse(
            tenant_id=row["id"],
            gym_name=row["nombre"],
            logo_url=branding.get("logo_url"),
            primary_color=branding.get("primary_color") or "#FF5722",
            secondary_color=branding.get("secondary_color") or "#1A1A1A",
            accent_color=branding.get("accent_color") or "#00E676",
            subdominio=row["subdominio"],
            app_movil_activa=bool(app_movil_activa),
        )

    @classmethod
    async def resolver_por_correo(
        cls,
        session: AsyncSession,
        correo: str,
    ) -> ResolverTenantResponse:
        """
        Resolución por correo en Pre-registro (Sección 4.1):
        Exige que la persona esté inscrita como DEPORTISTA activo en un gimnasio activo.
        Retorna el tenant_id, subdominio, tema visual y si es su primer ingreso (requiere_activacion).
        """
        correo_limpio = correo.strip().lower()

        # 1. Resolver únicamente contra fichas de deportistas activos en gimnasios activos
        res_dep = await session.execute(
            text("SELECT platform.gimnasio_id_por_correo_deportista(:correo)"),
            {"correo": correo_limpio},
        )
        gym_id = res_dep.scalar()

        if not gym_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "codigo": "DEPORTISTA_NO_REGISTRADO",
                    "mensaje": "No encontramos un deportista activo con este correo. Debes estar inscrito en un gimnasio para ingresar.",
                },
            )

        # 2. Fijar contexto RLS en PostgreSQL
        await fijar_gimnasio(session, gym_id)
        await session.execute(
            text("SELECT set_config('app.current_tenant_id', :gym_id, true)"),
            {"gym_id": str(gym_id)},
        )

        # 3. Verificar que el gimnasio esté operativo y su suscripción al día
        res_tenant = await session.execute(
            text("""
                SELECT id, nombre, subdominio, branding, activo
                FROM platform.tenant WHERE id = :gym_id
            """),
            {"gym_id": gym_id},
        )
        t_row = res_tenant.mappings().first()

        if not t_row or not t_row["activo"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"codigo": "GIMNASIO_SUSPENDIDO", "mensaje": "El gimnasio se encuentra suspendido o inactivo."},
            )

        await verificar_suscripcion_operativa(session, gym_id)

        # 4. Confirmar que exista la ficha activa de deportista en ese gimnasio y revisar si ya activó cuenta
        res_ficha = await session.execute(
            text("""
                SELECT d.id AS deportista_id,
                       ca.id AS cuenta_id,
                       ca.hash_password,
                       ca.activa AS cuenta_activa
                FROM platform.deportistas d
                LEFT JOIN platform.cuentas_app ca ON ca.deportista_id = d.id
                WHERE d.gimnasio_id = :gym_id
                  AND lower(d.correo::text) = :correo
                  AND d.deleted_at IS NULL
                  AND d.activo = true
                ORDER BY (ca.id IS NOT NULL) DESC, d.created_at DESC
                LIMIT 1
            """),
            {"gym_id": gym_id, "correo": correo_limpio},
        )
        ficha = res_ficha.mappings().first()

        if not ficha:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "codigo": "DEPORTISTA_NO_REGISTRADO",
                    "mensaje": "Tu ficha de deportista no se encuentra activa en el gimnasio. Consulta en recepción.",
                },
            )

        requiere_activacion = (
            ficha["cuenta_id"] is None
            or not ficha["cuenta_activa"]
            or not bool(ficha["hash_password"])
        )

        branding = cls._parsear_branding(t_row["branding"])
        app_movil_activa = branding.get("app_movil_activa", True)

        return ResolverTenantResponse(
            tenant_id=t_row["id"],
            gym_name=t_row["nombre"],
            logo_url=branding.get("logo_url"),
            primary_color=branding.get("primary_color") or "#FF5722",
            secondary_color=branding.get("secondary_color") or "#1A1A1A",
            accent_color=branding.get("accent_color") or "#00E676",
            subdominio=t_row["subdominio"],
            app_movil_activa=bool(app_movil_activa),
            usuario_existe=True,
            requiere_activacion=requiere_activacion,
        )
