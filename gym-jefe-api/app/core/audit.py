import hashlib
import json
from typing import Any, Dict, Optional
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class AuditService:
    """Servicio de auditoría append-only con encadenamiento de hashes (hash-chain)."""

    @staticmethod
    async def registrar(
        session: AsyncSession,
        gimnasio_id: UUID,
        actor_id: Optional[UUID],
        actor_nombre: str,
        accion: str,
        entidad: str,
        entidad_id: Optional[str] = None,
        detalle: Optional[Dict[str, Any]] = None,
        impersonando: bool = False
    ) -> None:
        # 1. Obtener hash actual previo para el gimnasio con bloqueo pesimista
        hash_query = text("""
            SELECT hash_actual FROM platform.auditoria_gym
            WHERE gimnasio_id = :gym_id
            ORDER BY id DESC
            LIMIT 1
            FOR UPDATE
        """)
        res = await session.execute(hash_query, {"gym_id": gimnasio_id})
        prev_hash = res.scalar() or "0" * 64

        # 2. Serializar detalle a JSON ordenado para consistencia del hash
        detalle_json = json.dumps(detalle, sort_keys=True) if detalle else "{}"

        # 3. Calcular hash SHA-256 encadenado
        cadena_a_hashear = f"{prev_hash}{actor_id or ''}{accion}{entidad}{entidad_id or ''}{detalle_json}"
        hash_actual = hashlib.sha256(cadena_a_hashear.encode("utf-8")).hexdigest()

        # 4. Insertar registro append-only
        insert_query = text("""
            INSERT INTO platform.auditoria_gym (
                gimnasio_id, actor_id, actor_nombre, impersonando,
                accion, entidad, entidad_id, detalle, hash_previo, hash_actual
            ) VALUES (
                :gym_id, :actor_id, :actor_nombre, :impersonando,
                :accion, :entidad, :entidad_id, CAST(:detalle AS jsonb), :hash_previo, :hash_actual
            )
        """)
        await session.execute(insert_query, {
            "gym_id": gimnasio_id,
            "actor_id": actor_id,
            "actor_nombre": actor_nombre,
            "impersonando": impersonando,
            "accion": accion,
            "entidad": entidad,
            "entidad_id": entidad_id,
            "detalle": detalle_json,
            "hash_previo": prev_hash,
            "hash_actual": hash_actual
        })

    @classmethod
    async def registrar_en_sesion_aislada(
        cls,
        gimnasio_id: UUID,
        accion: str,
        entidad: str,
        actor_id: Optional[UUID] = None,
        actor_nombre: Optional[str] = None,
        entidad_id: Optional[str] = None,
        detalle: Optional[Dict] = None,
        impersonando: bool = False
    ) -> None:
        """
        Registra un evento de auditoría en una transacción y conexión independiente.
        Útil para capturar eventos críticos de seguridad (ej. logins fallidos) que no
        deben revertirse incluso si la transacción principal del request hace rollback.
        
        REGLA RLS: Toda conexión aislada DEBE fijar app.gimnasio_id
        dentro de su transacción antes de insertar, para satisfacer la cláusula WITH CHECK
        de las políticas de Row-Level Security en PostgreSQL.
        """
        from app.core.database import async_session_maker
        async with async_session_maker() as isolated_session:
            async with isolated_session.begin():
                await isolated_session.execute(
                    text("SELECT set_config('app.gimnasio_id', :gym_id, true)"),
                    {"gym_id": str(gimnasio_id)}
                )
                await cls.registrar(
                    session=isolated_session,
                    gimnasio_id=gimnasio_id,
                    actor_id=actor_id,
                    actor_nombre=actor_nombre,
                    accion=accion,
                    entidad=entidad,
                    entidad_id=entidad_id,
                    detalle=detalle,
                    impersonando=impersonando
                )

    # Alias de compatibilidad
    registrar_aislado = registrar_en_sesion_aislada
