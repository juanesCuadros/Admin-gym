import json
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contexto_gimnasio import fijar_gimnasio
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
        Valida el correo contra deportistas o staff, resuelve el tenant_id
        y retorna la configuración de marca para tematizar la app inmediatamente.
        """
        correo_limpio = correo.strip().lower()

        # 1. Intentar resolver por función optimizada de deportista
        res_dep = await session.execute(
            text("SELECT platform.gimnasio_id_por_correo_deportista(:correo)"),
            {"correo": correo_limpio},
        )
        gym_id = res_dep.scalar()

        # 2. Si no es deportista, verificar si es staff del gimnasio
        if not gym_id:
            res_staff = await session.execute(
                text("""
                    SELECT gimnasio_id FROM platform.staff
                    WHERE lower(correo::text) = :correo
                      AND deleted_at IS NULL AND activo = true
                    ORDER BY created_at DESC LIMIT 1
                """),
                {"correo": correo_limpio},
            )
            gym_id = res_staff.scalar()

        if not gym_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "codigo": "CORREO_NO_REGISTRADO",
                    "mensaje": "No se encontró ningún gimnasio vinculado a este correo electrónico.",
                },
            )

        # 3. Fijar contexto de base de datos
        await fijar_gimnasio(session, gym_id)
        await session.execute(
            text("SELECT set_config('app.current_tenant_id', :gym_id, true)"),
            {"gym_id": str(gym_id)},
        )

        # 4. Obtener datos de la sede y verificar si requiere activación de contraseña
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

        # Verificar si ya tiene cuenta con contraseña establecida o es primer ingreso
        res_cuenta = await session.execute(
            text("""
                SELECT id, hash_password FROM platform.cuentas_app
                WHERE gimnasio_id = :gym_id AND lower(correo::text) = :correo AND activa = true
                LIMIT 1
            """),
            {"gym_id": gym_id, "correo": correo_limpio},
        )
        cuenta = res_cuenta.mappings().first()
        requiere_activacion = cuenta is None or not bool(cuenta["hash_password"])

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
