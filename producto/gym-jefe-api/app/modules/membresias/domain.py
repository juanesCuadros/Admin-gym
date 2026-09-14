"""
Servicio de Dominio Centralizado para Membresías y Estados de Deportistas (RF-27).
ÚNICA FUENTE DE VERDAD para el cálculo derivado del estado de acceso y membresía:
'activo' | 'por_vencer' | 'mora' | 'vencido' | 'congelado' | 'cancelada' | 'inactivo' | 'sin_membresia'.
"""
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezone import today_local


@dataclass(frozen=True)
class EstadoMembresiaCalculado:
    """Resultado estructurado e inmutable del cálculo de estado de membresía/acceso."""
    estado: str                     # 'activo' | 'por_vencer' | 'mora' | 'vencido' | 'congelado' | 'cancelada' | 'inactivo' | 'sin_membresia'
    dias_restantes_o_vencido: int
    permite_ingreso: bool
    resultado_acceso: str           # 'abrio' | 'alerta_mora' | 'negado'
    mensaje: str
    membresia_id: Optional[UUID] = None
    plan_nombre: Optional[str] = None
    fecha_vencimiento: Optional[date] = None
    congelamiento_activo: bool = False
    congelamiento_id: Optional[UUID] = None


class MembresiaDomainService:
    """Reglas de negocio puras y operaciones de dominio sobre el ciclo de vida de membresías."""

    @staticmethod
    def evaluar_estado_puro(
        hoy: date,
        activo_deportista: bool,
        tiene_membresia: bool,
        ultima_cancelada: bool = False,
        fecha_vencimiento: Optional[date] = None,
        congelamiento_activo: bool = False,
        dias_gracia_mora: int = 3,
        dias_umbral_por_vencer: int = 5,
        membresia_id: Optional[UUID] = None,
        plan_nombre: Optional[str] = None,
        congelamiento_id: Optional[UUID] = None,
    ) -> EstadoMembresiaCalculado:
        """
        Función PURA sin I/O para cálculo determinístico de reglas de membresía.
        Garantiza consistencia absoluta entre Control de Ingreso, Membresías y Listados.
        """
        # 1. Deportista desactivado administrativamente
        if not activo_deportista:
            return EstadoMembresiaCalculado(
                estado="inactivo",
                dias_restantes_o_vencido=0,
                permite_ingreso=False,
                resultado_acceso="negado",
                mensaje="Deportista desactivado por la administración",
                membresia_id=membresia_id,
                plan_nombre=plan_nombre,
                fecha_vencimiento=fecha_vencimiento
            )

        # 2. Sin membresías vigentes no canceladas
        if not tiene_membresia or fecha_vencimiento is None:
            if ultima_cancelada:
                return EstadoMembresiaCalculado(
                    estado="cancelada",
                    dias_restantes_o_vencido=0,
                    permite_ingreso=False,
                    resultado_acceso="negado",
                    mensaje="Membresía cancelada por la administración (RF-27)",
                    membresia_id=membresia_id,
                    plan_nombre=plan_nombre,
                    fecha_vencimiento=fecha_vencimiento
                )
            return EstadoMembresiaCalculado(
                estado="sin_membresia",
                dias_restantes_o_vencido=0,
                permite_ingreso=False,
                resultado_acceso="negado",
                mensaje="El deportista no cuenta con membresías registradas",
                membresia_id=membresia_id,
                plan_nombre=plan_nombre,
                fecha_vencimiento=fecha_vencimiento
            )

        # 3. Congelamiento vigente activo (RF-26)
        if congelamiento_activo:
            return EstadoMembresiaCalculado(
                estado="congelado",
                dias_restantes_o_vencido=0,
                permite_ingreso=False,
                resultado_acceso="negado",
                mensaje="Membresía congelada temporalmente (RF-26)",
                membresia_id=membresia_id,
                plan_nombre=plan_nombre,
                fecha_vencimiento=fecha_vencimiento,
                congelamiento_activo=True,
                congelamiento_id=congelamiento_id
            )

        # 4. Evaluación de vigencia temporal
        if fecha_vencimiento >= hoy:
            dias_restantes = (fecha_vencimiento - hoy).days
            if dias_restantes <= dias_umbral_por_vencer:
                return EstadoMembresiaCalculado(
                    estado="por_vencer",
                    dias_restantes_o_vencido=dias_restantes,
                    permite_ingreso=True,
                    resultado_acceso="abrio",
                    mensaje=f"Membresía próxima a vencer ({dias_restantes} días restantes)",
                    membresia_id=membresia_id,
                    plan_nombre=plan_nombre,
                    fecha_vencimiento=fecha_vencimiento
                )
            return EstadoMembresiaCalculado(
                estado="activo",
                dias_restantes_o_vencido=dias_restantes,
                permite_ingreso=True,
                resultado_acceso="abrio",
                mensaje="Membresía activa",
                membresia_id=membresia_id,
                plan_nombre=plan_nombre,
                fecha_vencimiento=fecha_vencimiento
            )
        else:
            dias_mora = (hoy - fecha_vencimiento).days
            if dias_mora <= dias_gracia_mora:
                return EstadoMembresiaCalculado(
                    estado="mora",
                    dias_restantes_o_vencido=dias_mora,
                    permite_ingreso=True,
                    resultado_acceso="alerta_mora",
                    mensaje=f"Membresía en periodo de gracia ({dias_mora} días de mora)",
                    membresia_id=membresia_id,
                    plan_nombre=plan_nombre,
                    fecha_vencimiento=fecha_vencimiento
                )
            return EstadoMembresiaCalculado(
                estado="vencido",
                dias_restantes_o_vencido=dias_mora,
                permite_ingreso=False,
                resultado_acceso="negado",
                mensaje=f"Membresía vencida hace {dias_mora} días",
                membresia_id=membresia_id,
                plan_nombre=plan_nombre,
                fecha_vencimiento=fecha_vencimiento
            )

    @classmethod
    async def calcular_estado_para_deportista(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        deportista_id: UUID,
        activo_deportista: bool,
        dias_gracia_mora: int = 3,
        dias_umbral_por_vencer: int = 5,
    ) -> EstadoMembresiaCalculado:
        """
        Orquesta la consulta a DB para un deportista específico y delega el cálculo a evaluar_estado_puro.
        Utilizado por Control de Ingreso (torniquetes) y Fichas 360°.
        """
        hoy = today_local()

        # 1. Membresía más reciente no cancelada
        q_memb = text("""
            SELECT m.id, m.plan_id, p.nombre as plan_nombre, m.fecha_inicio, m.fecha_vencimiento, m.cancelada
            FROM platform.membresias m
            JOIN platform.planes p ON p.id = m.plan_id
            WHERE m.gimnasio_id = :gym_id AND m.deportista_id = :deportista_id AND m.cancelada = false
            ORDER BY m.fecha_vencimiento DESC, m.created_at DESC
            LIMIT 1
        """)
        res_memb = await session.execute(q_memb, {"gym_id": gym_id, "deportista_id": deportista_id})
        memb = res_memb.mappings().first()

        if not memb:
            # Revisar si la última registrada fue cancelada explícitamente (RF-27)
            q_last = text("""
                SELECT id, cancelada
                FROM platform.membresias
                WHERE gimnasio_id = :gym_id AND deportista_id = :deportista_id
                ORDER BY fecha_vencimiento DESC, created_at DESC
                LIMIT 1
            """)
            res_last = await session.execute(q_last, {"gym_id": gym_id, "deportista_id": deportista_id})
            last_row = res_last.mappings().first()
            ultima_canc = bool(last_row and last_row["cancelada"])

            return cls.evaluar_estado_puro(
                hoy=hoy,
                activo_deportista=activo_deportista,
                tiene_membresia=False,
                ultima_cancelada=ultima_canc,
                dias_gracia_mora=dias_gracia_mora,
                dias_umbral_por_vencer=dias_umbral_por_vencer
            )

        # 2. Revisar si esta membresía específica tiene congelamiento abierto
        q_cong = text("""
            SELECT id FROM platform.congelamientos
            WHERE gimnasio_id = :gym_id AND membresia_id = :memb_id AND fecha_fin IS NULL
            LIMIT 1
        """)
        res_cong = await session.execute(q_cong, {"gym_id": gym_id, "memb_id": memb["id"]})
        cong_row = res_cong.mappings().first()

        return cls.evaluar_estado_puro(
            hoy=hoy,
            activo_deportista=activo_deportista,
            tiene_membresia=True,
            ultima_cancelada=False,
            fecha_vencimiento=memb["fecha_vencimiento"],
            congelamiento_activo=bool(cong_row),
            dias_gracia_mora=dias_gracia_mora,
            dias_umbral_por_vencer=dias_umbral_por_vencer,
            membresia_id=memb["id"],
            plan_nombre=memb["plan_nombre"],
            congelamiento_id=cong_row["id"] if cong_row else None
        )

    @classmethod
    async def enriquecer_membresias_batch(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        items: List[Dict[str, Any]],
        dias_gracia_mora: int = 3,
        dias_umbral_por_vencer: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Resuelve congelamientos vigentes para una lista paginada en UNA SOLA consulta batch:
        WHERE membresia_id = ANY(:ids) AND fecha_fin IS NULL
        Eliminando por completo el problema N+1 y evitando SQL alternativo divergente.
        """
        if not items:
            return []

        hoy = today_local()
        memb_ids = [item["id"] for item in items if item.get("id")]

        congelamientos_activos: Dict[UUID, UUID] = {}
        if memb_ids:
            q_batch = text("""
                SELECT id, membresia_id
                FROM platform.congelamientos
                WHERE gimnasio_id = :gym_id AND membresia_id = ANY(:ids) AND fecha_fin IS NULL
            """)
            res_batch = await session.execute(q_batch, {"gym_id": gym_id, "ids": memb_ids})
            for r in res_batch.fetchall():
                congelamientos_activos[r[1]] = r[0]

        enriquecidos = []
        for item in items:
            m_id = item["id"]
            cong_id = congelamientos_activos.get(m_id)
            calc = cls.evaluar_estado_puro(
                hoy=hoy,
                activo_deportista=item.get("deportista_activo", True),
                tiene_membresia=not item.get("cancelada", False),
                ultima_cancelada=item.get("cancelada", False),
                fecha_vencimiento=item.get("fecha_vencimiento"),
                congelamiento_activo=bool(cong_id),
                dias_gracia_mora=dias_gracia_mora,
                dias_umbral_por_vencer=dias_umbral_por_vencer,
                membresia_id=m_id,
                plan_nombre=item.get("plan_nombre"),
                congelamiento_id=cong_id
            )
            item_copy = dict(item)
            item_copy["estado_calculado"] = calc.estado
            item_copy["dias_restantes_o_vencido"] = calc.dias_restantes_o_vencido
            item_copy["congelamiento_activo"] = calc.congelamiento_activo
            item_copy["congelamiento_id"] = calc.congelamiento_id
            enriquecidos.append(item_copy)

        return enriquecidos
