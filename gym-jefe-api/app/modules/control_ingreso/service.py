import logging
from datetime import date, datetime
from typing import Awaitable, Callable, List, Optional, Tuple
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from zoneinfo import ZoneInfo

from app.core.audit import AuditService
from app.core.timezone import get_local_day_range_utc, now_local, today_local
from app.modules.control_ingreso.schemas import (
    CheckinItemHistorialDto,
    CheckinManualRequest,
    CheckinResponseDto,
    DeportistaCheckinDto,
    IngresoCortesiaRequest,
    ListadoIngresosHoyResponse,
    ResumenIngresosHoyDto,
)

logger = logging.getLogger(__name__)

# Tipo de callback asíncrono para eventos de acceso (Punto de extensión para Módulo 2: Pantalla TV)
CheckinEventListener = Callable[[UUID, CheckinResponseDto], Awaitable[None]]


class ControlIngresoService:
    """
    Orquestador de reglas de acceso, check-in biométrico/manual, cortesías y torniquete.
    Implementa deduplicación de 3 segundos, cálculo dinámico de membresía/mora/congelamiento/cancelación
    y punto de extensión desacoplado (pub/sub) para la pantalla de TV.
    """

    # Registro de listeners en memoria para emisión de eventos sin acoplamiento circular
    _listeners_checkin: List[CheckinEventListener] = []

    @classmethod
    def registrar_listener(cls, listener: CheckinEventListener) -> None:
        """
        Punto de extensión OCP: Permite que el Módulo 2 (Pantalla TV WebSocket)
        o futuros módulos registren callbacks ante check-ins sin alterar este servicio.
        """
        if listener not in cls._listeners_checkin:
            cls._listeners_checkin.append(listener)

    @classmethod
    async def _emitir_evento_checkin(cls, gym_id: UUID, checkin: CheckinResponseDto) -> None:
        """
        Dispara los callbacks registrados protegiendo la transacción principal contra fallos del listener.
        """
        for listener in cls._listeners_checkin:
            try:
                await listener(gym_id, checkin)
            except Exception as e:
                logger.error(f"Error al notificar listener de check-in en Pantalla TV: {e}", exc_info=True)

    @classmethod
    async def evaluar_y_procesar_checkin(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: Optional[UUID],
        deportista_id: UUID,
        metodo: str,  # 'huella' | 'manual'
    ) -> CheckinResponseDto:
        now_dt_local = now_local()

        # 1. Regla de Deduplicación (Ventana de 3 segundos) - Aplica tanto a 'huella' como a 'manual'
        dedup_query = text("""
            SELECT id, resultado, ts_utc
            FROM platform.checkins
            WHERE gimnasio_id = :gym_id
              AND deportista_id = :deportista_id
              AND ts_utc >= (now() - interval '3 seconds')
            ORDER BY ts_utc DESC
            LIMIT 1
        """)
        res_dedup = await session.execute(dedup_query, {"gym_id": gym_id, "deportista_id": deportista_id})
        prev_checkin = res_dedup.mappings().first()

        if prev_checkin:
            return CheckinResponseDto(
                checkin_id=prev_checkin["id"],
                tipo="ingreso",
                metodo=metodo,
                resultado=prev_checkin["resultado"],
                comando_torniquete=False,
                mensaje="Relectura ignorada dentro del intervalo de 3 segundos",
                relectura_ignorada=True,
                ts_local=now_dt_local
            )

        # 2. Consultar deportista y parámetros de mora/umbral del tenant
        dep_query = text("""
            SELECT d.id, d.documento, d.nombre, d.activo, d.deleted_at,
                   t.dias_gracia_mora, t.dias_umbral_por_vencer
            FROM platform.deportistas d
            JOIN platform.tenant t ON t.id = d.gimnasio_id
            WHERE d.id = :deportista_id AND d.gimnasio_id = :gym_id
        """)
        res_dep = await session.execute(dep_query, {"deportista_id": deportista_id, "gym_id": gym_id})
        dep = res_dep.mappings().first()

        if not dep or dep["deleted_at"] is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado en este gimnasio"}
            )

        # 3. Evaluar estado dinámico del deportista
        estado, dias_diff, mensaje_eval, permite_abrir, resultado_db = await cls._calcular_estado_acceso(
            session=session,
            gym_id=gym_id,
            deportista_id=deportista_id,
            activo=dep["activo"],
            dias_gracia=dep["dias_gracia_mora"],
            dias_umbral_por_vencer=dep.get("dias_umbral_por_vencer", 5)
        )

        # 4. Insertar evento de check-in en platform.checkins
        insert_query = text("""
            INSERT INTO platform.checkins (
                gimnasio_id, deportista_id, tipo, metodo, resultado, registrado_por, ts_utc
            ) VALUES (
                :gym_id, :deportista_id, 'ingreso', :metodo, :resultado, :staff_id, now()
            ) RETURNING id
        """)
        res_insert = await session.execute(insert_query, {
            "gym_id": gym_id,
            "deportista_id": deportista_id,
            "metodo": metodo,
            "resultado": resultado_db,
            "staff_id": staff_id
        })
        nuevo_id = res_insert.scalar_one()

        deportista_dto = DeportistaCheckinDto(
            id=dep["id"],
            documento=dep["documento"],
            nombre=dep["nombre"],
            estado_calculado=estado,
            dias_restantes_o_vencido=dias_diff
        )

        response_dto = CheckinResponseDto(
            checkin_id=nuevo_id,
            tipo="ingreso",
            metodo=metodo,
            resultado=resultado_db,
            comando_torniquete=permite_abrir,
            mensaje=mensaje_eval,
            relectura_ignorada=False,
            deportista=deportista_dto,
            ts_local=now_dt_local
        )

        # 5. Emitir evento hacia listeners suscritos (p. ej. Pantalla TV WebSocket)
        await cls._emitir_evento_checkin(gym_id, response_dto)

        return response_dto

    @classmethod
    async def checkin_manual(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        data: CheckinManualRequest
    ) -> CheckinResponseDto:
        target_id = data.deportista_id

        # Si viene por documento, resolver deportista_id
        if not target_id and data.documento:
            doc_query = text("""
                SELECT id FROM platform.deportistas
                WHERE gimnasio_id = :gym_id AND documento = :doc AND deleted_at IS NULL
            """)
            res_doc = await session.execute(doc_query, {"gym_id": gym_id, "doc": data.documento.strip()})
            row = res_doc.mappings().first()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": f"No existe un deportista con documento {data.documento}"}
                )
            target_id = row["id"]

        if not target_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "PARAMETROS_INSUFICIENTES", "mensaje": "Debe proporcionar deportista_id o documento"}
            )

        # Ejecuta la misma lógica central con deduplicación y reglas dinámicas
        return await cls.evaluar_y_procesar_checkin(
            session=session,
            gym_id=gym_id,
            staff_id=staff_id,
            deportista_id=target_id,
            metodo="manual"
        )

    @classmethod
    async def registrar_cortesia(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        data: IngresoCortesiaRequest
    ) -> CheckinResponseDto:
        # 1. Insertar evento de cortesía (deportista_id es NULL, motivo obligatorio)
        insert_query = text("""
            INSERT INTO platform.checkins (
                gimnasio_id, deportista_id, tipo, metodo, resultado, motivo_cortesia, registrado_por, ts_utc
            ) VALUES (
                :gym_id, NULL, 'cortesia', 'manual', 'abrio', :motivo, :staff_id, now()
            ) RETURNING id
        """)
        res = await session.execute(insert_query, {
            "gym_id": gym_id,
            "motivo": data.motivo.strip(),
            "staff_id": staff_id
        })
        nuevo_id = res.scalar_one()

        # 2. Registrar en auditoría inmutable (RF-05 / hash-chain)
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="INGRESO_CORTESIA",
            entidad="checkins",
            entidad_id=str(nuevo_id),
            detalle={"motivo": data.motivo.strip()}
        )

        response_dto = CheckinResponseDto(
            checkin_id=nuevo_id,
            tipo="cortesia",
            metodo="manual",
            resultado="abrio",
            comando_torniquete=True,
            mensaje="Ingreso de cortesía concedido. Torniquete abierto.",
            relectura_ignorada=False,
            deportista=None,
            ts_local=now_local()
        )

        # 3. Notificar evento a listeners suscritos (Pantalla TV)
        await cls._emitir_evento_checkin(gym_id, response_dto)

        return response_dto

    @classmethod
    async def obtener_ingresos_hoy(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        limit: int = 50,
        offset: int = 0
    ) -> ListadoIngresosHoyResponse:
        """
        Obtiene el resumen y listado de ingresos del día actual.
        Conforme a RNF-08:
        1. Se calcula la fecha en la zona horaria local (America/Bogota).
        2. Se convierte el día local al rango UTC [00:00:00, 23:59:59.999999] local.
        3. El query filtra con B-Tree index por 'ts_utc BETWEEN :inicio_utc AND :fin_utc' (óptimo).
        4. Las fechas retornadas se serializan a hora local en Bogota.
        """
        hoy = today_local()
        inicio_utc, fin_utc = get_local_day_range_utc(hoy)

        # 1. Resumen y totales del día
        stats_query = text("""
            SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE resultado = 'abrio') as abrio,
                COUNT(*) FILTER (WHERE resultado = 'alerta_mora') as alerta,
                COUNT(*) FILTER (WHERE resultado = 'negado') as negado,
                COUNT(*) FILTER (WHERE tipo = 'cortesia') as cortesia
            FROM platform.checkins
            WHERE gimnasio_id = :gym_id AND ts_utc BETWEEN :inicio_utc AND :fin_utc
        """)
        res_stats = await session.execute(stats_query, {
            "gym_id": gym_id,
            "inicio_utc": inicio_utc,
            "fin_utc": fin_utc
        })
        st = res_stats.mappings().first()

        resumen = ResumenIngresosHoyDto(
            fecha=hoy,
            total_ingresos=st["total"] or 0,
            accesos_abiertos=st["abrio"] or 0,
            alertas_mora=st["alerta"] or 0,
            accesos_negados=st["negado"] or 0,
            cortesias=st["cortesia"] or 0
        )

        # 2. Listado cronológico de accesos
        items_query = text("""
            SELECT 
                c.id, c.tipo, c.metodo, c.resultado, c.motivo_cortesia, c.ts_utc,
                c.deportista_id, d.nombre as deportista_nombre, d.documento as deportista_documento,
                s.nombre as registrado_por_nombre
            FROM platform.checkins c
            LEFT JOIN platform.deportistas d ON d.id = c.deportista_id
            LEFT JOIN platform.staff s ON s.id = c.registrado_por
            WHERE c.gimnasio_id = :gym_id AND c.ts_utc BETWEEN :inicio_utc AND :fin_utc
            ORDER BY c.ts_utc DESC
            LIMIT :limit OFFSET :offset
        """)
        res_items = await session.execute(items_query, {
            "gym_id": gym_id,
            "inicio_utc": inicio_utc,
            "fin_utc": fin_utc,
            "limit": limit,
            "offset": offset
        })

        bogota_tz = ZoneInfo("America/Bogota")
        items = []
        for r in res_items.mappings():
            dt_local = r["ts_utc"].astimezone(bogota_tz)
            items.append(CheckinItemHistorialDto(
                id=r["id"],
                tipo=r["tipo"],
                metodo=r["metodo"],
                resultado=r["resultado"],
                motivo_cortesia=r["motivo_cortesia"],
                deportista_id=r["deportista_id"],
                deportista_nombre=r["deportista_nombre"],
                deportista_documento=r["deportista_documento"],
                registrado_por_nombre=r["registrado_por_nombre"],
                ts_local=dt_local
            ))

        return ListadoIngresosHoyResponse(resumen=resumen, items=items)

    @classmethod
    async def pre_evaluar_acceso(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        deportista_id: UUID
    ) -> DeportistaCheckinDto:
        dep_query = text("""
            SELECT d.id, d.documento, d.nombre, d.activo, t.dias_gracia_mora, t.dias_umbral_por_vencer
            FROM platform.deportistas d
            JOIN platform.tenant t ON t.id = d.gimnasio_id
            WHERE d.id = :deportista_id AND d.gimnasio_id = :gym_id AND d.deleted_at IS NULL
        """)
        res_dep = await session.execute(dep_query, {"deportista_id": deportista_id, "gym_id": gym_id})
        dep = res_dep.mappings().first()
        if not dep:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado"}
            )

        estado, dias_diff, _, _, _ = await cls._calcular_estado_acceso(
            session=session,
            gym_id=gym_id,
            deportista_id=deportista_id,
            activo=dep["activo"],
            dias_gracia=dep["dias_gracia_mora"],
            dias_umbral_por_vencer=dep.get("dias_umbral_por_vencer", 5)
        )

        return DeportistaCheckinDto(
            id=dep["id"],
            documento=dep["documento"],
            nombre=dep["nombre"],
            estado_calculado=estado,
            dias_restantes_o_vencido=dias_diff
        )

    @staticmethod
    async def _calcular_estado_acceso(
        session: AsyncSession,
        gym_id: UUID,
        deportista_id: UUID,
        activo: bool,
        dias_gracia: int,
        dias_umbral_por_vencer: int = 5
    ) -> Tuple[str, int, str, bool, str]:
        """
        Calcula el estado derivado del deportista y su comando de torniquete.
        Retorna: (estado_str, dias_diff, mensaje, permite_abrir, resultado_db)
        donde resultado_db in ('abrio', 'alerta_mora', 'negado').
        
        Manejo estricto de membresías múltiples, cancelaciones y congelamientos:
        1. Si el deportista tiene 'activo = false' -> 'inactivo', negado.
        2. Selecciona la membresía no cancelada con fecha_vencimiento más reciente.
        3. Si no hay membresías no canceladas:
           - Revisa si la última membresía registrada tiene 'cancelada = true' (RF-27) -> 'cancelada', negado.
           - Si no tiene registros en absoluto -> 'sin_membresia', negado.
        4. Si hay membresía no cancelada:
           - Amarra el congelamiento vigente DIRECTAMENTE a esa 'membresia_id' específica (RF-26).
             Si tiene congelamiento abierto (fecha_fin IS NULL) -> 'congelado', negado.
        5. Evalúa fecha_vencimiento contra hoy local (America/Bogota):
           - fecha_vencimiento >= hoy:
             * dias_restantes <= dias_umbral_por_vencer -> 'por_vencer', comando=True, resultado='abrio'.
             * dias_restantes > dias_umbral_por_vencer  -> 'activo', comando=True, resultado='abrio'.
           - fecha_vencimiento < hoy:
             * dias_mora <= dias_gracia -> 'mora', comando=True, resultado='alerta_mora'.
             * dias_mora > dias_gracia  -> 'vencido', comando=False, resultado='negado'.
        """
        if not activo:
            return ("inactivo", 0, "Deportista desactivado por la administración", False, "negado")

        hoy = today_local()

        # 1. Consultar la membresía no cancelada más reciente
        memb_query = text("""
            SELECT id, fecha_inicio, fecha_vencimiento, cancelada
            FROM platform.membresias
            WHERE gimnasio_id = :gym_id AND deportista_id = :deportista_id AND cancelada = false
            ORDER BY fecha_vencimiento DESC
            LIMIT 1
        """)
        res_memb = await session.execute(memb_query, {"gym_id": gym_id, "deportista_id": deportista_id})
        memb = res_memb.mappings().first()

        # 2. Si no hay membresía activa no cancelada, evaluar si la última fue cancelada (RF-27)
        if not memb:
            last_memb_query = text("""
                SELECT id, cancelada
                FROM platform.membresias
                WHERE gimnasio_id = :gym_id AND deportista_id = :deportista_id
                ORDER BY fecha_vencimiento DESC
                LIMIT 1
            """)
            res_last = await session.execute(last_memb_query, {"gym_id": gym_id, "deportista_id": deportista_id})
            last_memb = res_last.mappings().first()
            if last_memb and last_memb["cancelada"]:
                return ("cancelada", 0, "Membresía cancelada por la administración (RF-27)", False, "negado")
            return ("sin_membresia", 0, "El deportista no cuenta con membresías registradas", False, "negado")

        membresia_id = memb["id"]
        fecha_venc: date = memb["fecha_vencimiento"]

        # 3. Verificar congelamiento vigente amarrado a ESTA membresía específica (RF-26)
        cong_query = text("""
            SELECT id, fecha_inicio
            FROM platform.congelamientos
            WHERE gimnasio_id = :gym_id 
              AND membresia_id = :membresia_id 
              AND fecha_fin IS NULL
            LIMIT 1
        """)
        res_cong = await session.execute(cong_query, {"gym_id": gym_id, "membresia_id": membresia_id})
        if res_cong.mappings().first():
            return ("congelado", 0, "Membresía congelada. Debe solicitar el descongelamiento previo", False, "negado")

        # 4. Evaluar vigencia
        if fecha_venc >= hoy:
            dias_restantes = (fecha_venc - hoy).days
            if dias_restantes <= dias_umbral_por_vencer:
                return (
                    "por_vencer",
                    dias_restantes,
                    f"Acceso concedido. Membresía por vencer en {dias_restantes} día(s) ({fecha_venc})",
                    True,
                    "abrio"
                )
            return (
                "activo",
                dias_restantes,
                f"Acceso concedido. Vence en {dias_restantes} días ({fecha_venc})",
                True,
                "abrio"
            )

        # Está vencido: calcular días de mora contra tenant.dias_gracia_mora
        dias_mora = (hoy - fecha_venc).days
        if dias_mora <= dias_gracia:
            return (
                "mora",
                dias_mora,
                f"Acceso con alerta de mora: membresía vencida hace {dias_mora} día(s). Período de gracia permitido ({dias_gracia} días).",
                True,
                "alerta_mora"
            )
        else:
            return (
                "vencido",
                dias_mora,
                f"Acceso denegado: membresía vencida hace {dias_mora} día(s). Superó el período de gracia permitido ({dias_gracia} días).",
                False,
                "negado"
            )
