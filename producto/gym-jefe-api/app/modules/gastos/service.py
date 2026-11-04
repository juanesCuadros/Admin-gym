"""
Gastos y pago a entrenadores.

- El gasto en efectivo sale de la caja del turno propio: deja un egreso, así el arqueo lo descuenta.
- La transferencia no toca la caja.
- El pago a un entrenador es un gasto más, con su liquidación del periodo. Solo lo registra el Jefe.
"""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.core.timezone import get_local_day_range_utc, today_local
from app.modules.caja.schemas import RegistrarEgresoRequest
from app.modules.caja.service import CajaService
from app.modules.gastos.schemas import (
    BeneficiarioStaff,
    ConfigPagoEntrenadorRequest,
    GastoResponse,
    LiquidacionEntrenador,
    ListadoGastosResponse,
    PagoEntrenadorResponse,
    RegistrarGastoRequest,
    RegistrarPagoEntrenadorRequest,
    ReporteResultadoResponse,
)

CATEGORIA_PAGO_ENTRENADOR = "Pago a entrenador"

SELECT_GASTO = """
    SELECT g.id, g.categoria, g.descripcion, g.beneficiario_tipo, g.beneficiario_staff_id, g.beneficiario_nombre,
           g.metodo, g.monto, g.fecha, g.turno_id, g.created_at, s.nombre AS registrado_por_nombre
    FROM platform.gastos g
    LEFT JOIN platform.staff s ON s.id = g.registrado_por
"""


def _validar_rango(desde: date, hasta: date) -> None:
    if hasta < desde:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"codigo": "RANGO_FECHAS_INVALIDO", "mensaje": "La fecha inicial no puede ser posterior a la final."},
        )


def _a_pesos(valor: Decimal) -> Decimal:
    return valor.quantize(Decimal("1"), rounding=ROUND_HALF_UP)


class GastosService:
    @staticmethod
    async def listar_beneficiarios(session: AsyncSession, gym_id: UUID) -> list[BeneficiarioStaff]:
        filas = await session.execute(
            text("SELECT id, nombre, rol FROM platform.staff WHERE gimnasio_id = :gym_id AND activo = true ORDER BY nombre"),
            {"gym_id": gym_id},
        )
        return [BeneficiarioStaff(**dict(f)) for f in filas.mappings().all()]

    @staticmethod
    async def _gasto_por_id(session: AsyncSession, gym_id: UUID, gasto_id: UUID) -> GastoResponse:
        fila = (
            await session.execute(
                text(SELECT_GASTO + " WHERE g.id = :id AND g.gimnasio_id = :gym_id"), {"id": gasto_id, "gym_id": gym_id}
            )
        ).mappings().one()
        return GastoResponse(**dict(fila))

    @classmethod
    async def _insertar_gasto(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        clave: str,
        categoria: str,
        descripcion: Optional[str],
        beneficiario_tipo: str,
        beneficiario_staff_id: Optional[UUID],
        beneficiario_nombre: str,
        metodo: str,
        monto: Decimal,
    ) -> UUID:
        turno_id = egreso_id = None
        if metodo == "efectivo":
            # Exige turno abierto propio y deja el egreso que el arqueo descuenta.
            egreso = await CajaService.registrar_egreso(
                session=session,
                gym_id=gym_id,
                staff_id=staff_id,
                staff_nombre=staff_nombre,
                data=RegistrarEgresoRequest(motivo=f"{categoria}: {beneficiario_nombre}"[:255], monto=monto),
            )
            turno_id, egreso_id = egreso.turno_id, egreso.id
        try:
            async with session.begin_nested():
                gasto_id = (
                    await session.execute(
                        text("""
                            INSERT INTO platform.gastos (
                                gimnasio_id, categoria, descripcion, beneficiario_tipo, beneficiario_staff_id,
                                beneficiario_nombre, metodo, monto, fecha, turno_id, egreso_id, idempotency_key, registrado_por
                            ) VALUES (
                                :gym_id, :categoria, :descripcion, :tipo, :staff_ben, :nombre, :metodo, :monto, :fecha,
                                :turno_id, :egreso_id, :clave, :staff_id
                            ) RETURNING id
                        """),
                        {
                            "gym_id": gym_id,
                            "categoria": categoria,
                            "descripcion": (descripcion or "").strip() or None,
                            "tipo": beneficiario_tipo,
                            "staff_ben": beneficiario_staff_id,
                            "nombre": beneficiario_nombre,
                            "metodo": metodo,
                            "monto": monto,
                            "fecha": today_local(),
                            "turno_id": turno_id,
                            "egreso_id": egreso_id,
                            "clave": clave,
                            "staff_id": staff_id,
                        },
                    )
                ).scalar_one()
        except IntegrityError:
            # Otra petición ganó con la misma clave: se deshace todo, incluido el egreso.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "CLAVE_IDEMPOTENCIA_EN_USO", "mensaje": "Este registro ya se está procesando."},
            )
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="REGISTRAR_GASTO",
            entidad="gastos",
            entidad_id=str(gasto_id),
            detalle={"categoria": categoria, "beneficiario": beneficiario_nombre, "metodo": metodo, "monto": float(monto)},
        )
        return gasto_id

    @staticmethod
    async def _existente(session: AsyncSession, gym_id: UUID, clave: str) -> Optional[UUID]:
        return (
            await session.execute(
                text("SELECT id FROM platform.gastos WHERE gimnasio_id = :gym_id AND idempotency_key = :clave"),
                {"gym_id": gym_id, "clave": clave},
            )
        ).scalar()

    @classmethod
    async def registrar_gasto(
        cls, session: AsyncSession, gym_id: UUID, staff_id: UUID, staff_nombre: str, clave: str, req: RegistrarGastoRequest
    ) -> GastoResponse:
        clave = clave.strip()
        existente = await cls._existente(session, gym_id, clave)
        if existente:
            return await cls._gasto_por_id(session, gym_id, existente)

        nombre = (req.beneficiario_nombre or "").strip()
        staff_ben = req.beneficiario_staff_id if req.beneficiario_tipo == "staff" else None
        if staff_ben:
            nombre = (
                await session.execute(
                    text("SELECT nombre FROM platform.staff WHERE id = :id AND gimnasio_id = :gym_id"),
                    {"id": staff_ben, "gym_id": gym_id},
                )
            ).scalar()
            if not nombre:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "STAFF_NO_ENCONTRADO", "mensaje": "Esa persona no pertenece a este gimnasio."},
                )
        gasto_id = await cls._insertar_gasto(
            session, gym_id, staff_id, staff_nombre, clave, req.categoria.strip(), req.descripcion,
            req.beneficiario_tipo, staff_ben, nombre, req.metodo, req.monto,
        )
        return await cls._gasto_por_id(session, gym_id, gasto_id)

    @staticmethod
    async def listar_gastos(
        session: AsyncSession, gym_id: UUID, desde: date, hasta: date, categoria: Optional[str], limit: int, offset: int
    ) -> ListadoGastosResponse:
        _validar_rango(desde, hasta)
        condicion = "g.gimnasio_id = :gym_id AND g.fecha BETWEEN :desde AND :hasta"
        params = {"gym_id": gym_id, "desde": desde, "hasta": hasta, "limit": limit, "offset": offset}
        if categoria:
            condicion += " AND lower(g.categoria) = lower(:categoria)"
            params["categoria"] = categoria.strip()
        resumen = (
            await session.execute(
                text(f"SELECT COUNT(*) AS total, COALESCE(SUM(g.monto), 0) AS suma FROM platform.gastos g WHERE {condicion}"), params
            )
        ).mappings().one()
        filas = await session.execute(
            text(SELECT_GASTO + f" WHERE {condicion} ORDER BY g.fecha DESC, g.created_at DESC LIMIT :limit OFFSET :offset"),
            params,
        )
        return ListadoGastosResponse(
            items=[GastoResponse(**dict(f)) for f in filas.mappings().all()],
            total=resumen["total"],
            suma=resumen["suma"],
        )

    @staticmethod
    async def reporte_resultado(session: AsyncSession, gym_id: UUID, desde: date, hasta: date) -> ReporteResultadoResponse:
        """Ingresos menos gastos. Lo anulado no suma, igual que en el reporte de ingresos."""
        _validar_rango(desde, hasta)
        inicio_utc, _ = get_local_day_range_utc(desde)
        _, fin_utc = get_local_day_range_utc(hasta)
        params = {"gym_id": gym_id, "inicio": inicio_utc, "fin": fin_utc, "desde": desde, "hasta": hasta}
        ingresos = (
            await session.execute(
                text("""
                    SELECT
                      (SELECT COALESCE(SUM(total), 0) FROM platform.ventas
                       WHERE gimnasio_id = :gym_id AND anulada = false AND created_at BETWEEN :inicio AND :fin)
                      +
                      (SELECT COALESCE(SUM(monto), 0) FROM platform.pagos_membresia
                       WHERE gimnasio_id = :gym_id AND anulado = false AND created_at BETWEEN :inicio AND :fin)
                """),
                params,
            )
        ).scalar_one()
        filas = await session.execute(
            text("""
                SELECT categoria, SUM(monto) AS suma FROM platform.gastos
                WHERE gimnasio_id = :gym_id AND fecha BETWEEN :desde AND :hasta
                GROUP BY categoria ORDER BY suma DESC
            """),
            params,
        )
        por_categoria = {f["categoria"]: f["suma"] for f in filas.mappings().all()}
        gastos = sum(por_categoria.values(), Decimal("0"))
        return ReporteResultadoResponse(
            desde=desde, hasta=hasta, ingresos=ingresos, gastos=gastos, resultado=ingresos - gastos, gastos_por_categoria=por_categoria
        )

    # ------------------------------------------------------------------
    # Pago a entrenadores
    # ------------------------------------------------------------------
    @classmethod
    async def _liquidar(
        cls, session: AsyncSession, gym_id: UUID, entrenador: dict, desde: date, hasta: date
    ) -> LiquidacionEntrenador:
        inicio_utc, _ = get_local_day_range_utc(desde)
        _, fin_utc = get_local_day_range_utc(hasta)
        params = {"gym_id": gym_id, "staff": entrenador["id"], "inicio": inicio_utc, "fin": fin_utc, "desde": desde, "hasta": hasta}

        clases = (
            await session.execute(
                text("""
                    SELECT COUNT(*) FROM platform.clases
                    WHERE gimnasio_id = :gym_id AND entrenador_id = :staff AND estado = 'realizada'
                      AND fecha_hora BETWEEN :inicio AND :fin
                """),
                params,
            )
        ).scalar_one()
        # Lo pagado se cruza con el periodo consultado: así no se paga dos veces la misma quincena.
        pagado = (
            await session.execute(
                text("""
                    SELECT COALESCE(SUM(monto_pagado), 0) FROM platform.pagos_entrenador
                    WHERE gimnasio_id = :gym_id AND staff_id = :staff
                      AND periodo_desde <= :hasta AND periodo_hasta >= :desde
                """),
                params,
            )
        ).scalar_one()

        esquema, valor, base_comision = entrenador.get("esquema"), entrenador.get("valor"), entrenador.get("base_comision")
        base = Decimal("0")
        calculado = Decimal("0")
        if esquema == "fijo":
            calculado = Decimal(valor)
        elif esquema == "por_clase":
            calculado = Decimal(valor) * clases
        elif esquema == "comision":
            if base_comision == "membresias_vendidas":
                consulta = """
                    SELECT COALESCE(SUM(pm.monto), 0) FROM platform.pagos_membresia pm
                    WHERE pm.gimnasio_id = :gym_id AND pm.anulado = false AND pm.registrado_por = :staff
                      AND pm.created_at BETWEEN :inicio AND :fin
                """
            else:
                # Cliente asignado: tiene una rutina activa que le asignó este entrenador.
                consulta = """
                    SELECT COALESCE(SUM(pm.monto), 0) FROM platform.pagos_membresia pm
                    WHERE pm.gimnasio_id = :gym_id AND pm.anulado = false AND pm.created_at BETWEEN :inicio AND :fin
                      AND EXISTS (
                        SELECT 1 FROM platform.membresias m
                        JOIN platform.rutinas_asignadas r ON r.deportista_id = m.deportista_id
                        WHERE (m.id = pm.membresia_id OR m.paquete_id = pm.paquete_id)
                          AND r.entrenador_id = :staff AND r.activa = true
                      )
                """
            base = (await session.execute(text(consulta), params)).scalar_one()
            calculado = Decimal(base) * Decimal(valor) / Decimal("100")

        calculado = _a_pesos(calculado)
        return LiquidacionEntrenador(
            staff_id=entrenador["id"],
            nombre=entrenador["nombre"],
            esquema=esquema,
            valor=valor,
            base_comision=base_comision,
            clases_dictadas=clases,
            base_calculo=base,
            monto_calculado=calculado,
            pagado=pagado,
            saldo=max(calculado - Decimal(pagado), Decimal("0")),
        )

    @staticmethod
    async def _entrenador(session: AsyncSession, gym_id: UUID, staff_id: Optional[UUID] = None) -> list[dict]:
        filtro = "AND s.id = :staff" if staff_id else "AND s.activo = true"
        params = {"gym_id": gym_id}
        if staff_id:
            params["staff"] = staff_id
        filas = await session.execute(
            text(f"""
                SELECT s.id, s.nombre, c.esquema, c.valor, c.base_comision
                FROM platform.staff s
                LEFT JOIN platform.entrenador_pago_config c ON c.staff_id = s.id
                WHERE s.gimnasio_id = :gym_id AND s.rol = 'entrenador' {filtro}
                ORDER BY s.nombre
            """),
            params,
        )
        return [dict(f) for f in filas.mappings().all()]

    @classmethod
    async def listar_liquidaciones(
        cls, session: AsyncSession, gym_id: UUID, desde: date, hasta: date
    ) -> list[LiquidacionEntrenador]:
        _validar_rango(desde, hasta)
        return [await cls._liquidar(session, gym_id, e, desde, hasta) for e in await cls._entrenador(session, gym_id)]

    @classmethod
    async def _exigir_entrenador(cls, session: AsyncSession, gym_id: UUID, staff_id: UUID) -> dict:
        encontrados = await cls._entrenador(session, gym_id, staff_id)
        if not encontrados:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "ENTRENADOR_NO_ENCONTRADO", "mensaje": "Ese entrenador no existe en este gimnasio."},
            )
        return encontrados[0]

    @classmethod
    async def configurar_pago(
        cls, session: AsyncSession, gym_id: UUID, actor_id: UUID, actor_nombre: str, staff_id: UUID, req: ConfigPagoEntrenadorRequest
    ) -> LiquidacionEntrenador:
        await cls._exigir_entrenador(session, gym_id, staff_id)
        await session.execute(
            text("""
                INSERT INTO platform.entrenador_pago_config (staff_id, gimnasio_id, esquema, valor, base_comision)
                VALUES (:staff, :gym_id, :esquema, :valor, :base)
                ON CONFLICT (staff_id) DO UPDATE
                SET esquema = EXCLUDED.esquema, valor = EXCLUDED.valor, base_comision = EXCLUDED.base_comision, updated_at = now()
            """),
            {"staff": staff_id, "gym_id": gym_id, "esquema": req.esquema, "valor": req.valor, "base": req.base_comision},
        )
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor_id,
            actor_nombre=actor_nombre,
            accion="CONFIGURAR_PAGO_ENTRENADOR",
            entidad="entrenador_pago_config",
            entidad_id=str(staff_id),
            detalle={"esquema": req.esquema, "valor": float(req.valor), "base_comision": req.base_comision},
        )
        hoy = today_local()
        return await cls._liquidar(session, gym_id, await cls._exigir_entrenador(session, gym_id, staff_id), hoy, hoy)

    @classmethod
    async def registrar_pago(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        actor_id: UUID,
        actor_nombre: str,
        staff_id: UUID,
        clave: str,
        req: RegistrarPagoEntrenadorRequest,
    ) -> PagoEntrenadorResponse:
        clave = clave.strip()
        columnas = "p.id, p.staff_id, p.periodo_desde, p.periodo_hasta, p.monto_calculado, p.monto_pagado, p.gasto_id"
        existente = await cls._existente(session, gym_id, clave)
        if existente:
            fila = (
                await session.execute(
                    text(f"SELECT {columnas} FROM platform.pagos_entrenador p WHERE p.gasto_id = :gasto"), {"gasto": existente}
                )
            ).mappings().one()
            return PagoEntrenadorResponse(**dict(fila))

        entrenador = await cls._exigir_entrenador(session, gym_id, staff_id)
        liquidacion = await cls._liquidar(session, gym_id, entrenador, req.desde, req.hasta)
        gasto_id = await cls._insertar_gasto(
            session, gym_id, actor_id, actor_nombre, clave, CATEGORIA_PAGO_ENTRENADOR,
            req.descripcion or f"Periodo {req.desde.isoformat()} a {req.hasta.isoformat()}",
            "staff", staff_id, entrenador["nombre"], req.metodo, req.monto,
        )
        fila = (
            await session.execute(
                text("""
                    INSERT INTO platform.pagos_entrenador
                      (gimnasio_id, staff_id, periodo_desde, periodo_hasta, monto_calculado, monto_pagado, gasto_id, registrado_por)
                    VALUES (:gym_id, :staff, :desde, :hasta, :calculado, :pagado, :gasto, :actor)
                    RETURNING id, staff_id, periodo_desde, periodo_hasta, monto_calculado, monto_pagado, gasto_id
                """),
                {
                    "gym_id": gym_id,
                    "staff": staff_id,
                    "desde": req.desde,
                    "hasta": req.hasta,
                    "calculado": liquidacion.monto_calculado,
                    "pagado": req.monto,
                    "gasto": gasto_id,
                    "actor": actor_id,
                },
            )
        ).mappings().one()
        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=actor_id,
            actor_nombre=actor_nombre,
            accion="PAGAR_ENTRENADOR",
            entidad="pagos_entrenador",
            entidad_id=str(fila["id"]),
            detalle={
                "entrenador": entrenador["nombre"],
                "monto_calculado": float(liquidacion.monto_calculado),
                "monto_pagado": float(req.monto),
                "metodo": req.metodo,
            },
        )
        return PagoEntrenadorResponse(**dict(fila))
