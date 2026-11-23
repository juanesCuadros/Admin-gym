"""
Descarga de datos hacia la estación (`GET /sync/pull`).

Cursor seguro frente a transacciones que confirman tarde
--------------------------------------------------------
Cada fila sincronizable lleva `sync_xid`: el id de la transacción que la escribió (migración 070).
Una ronda de descarga hace esto:

1. Al empezar anota `siguiente` = el id de la transacción más vieja que sigue abierta en ese instante.
2. Envía, paginado, todo lo visible con `sync_xid >= desde`.
3. Al terminar, el cursor de la próxima ronda es `desde = siguiente`.

Una transacción que estaba abierta durante la ronda tiene, por definición, un id mayor o igual a
`siguiente`: cuando confirme, la próxima ronda la trae. Lo que ya se envió y vuelve a quedar dentro
del rango se repite, y la estación lo aplica otra vez sin duplicar (reemplaza por id).
Con `updated_at` esa transacción quedaría con fecha anterior al cursor y se perdería.
"""
import base64
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.sync.dependencias import EstacionAutenticada
from app.modules.sync.schemas import PullResponse, SuscripcionEstacionDto

LIMITE_POR_DEFECTO = 500
LIMITE_MAXIMO = 1000

# Solo lo que recepción necesita. Sin hashes, sin contacto ni salud de los deportistas, sin costos.
# (nombre en la respuesta, tabla, tipo del id, columnas, filtro adicional)
# El cursor guarda la posición en esta lista: las tablas nuevas se agregan AL FINAL, nunca en medio.
_TABLAS: List[tuple] = [
    ("gimnasio", "tenant", "uuid", """
        id, nombre, subdominio, zona_horaria, dias_gracia_mora, dias_umbral_por_vencer,
        permitir_descuentos, tope_descuento_pct, metodos_pago, branding, duracion_sesion_minutos,
        round(precio_pase_dia)::bigint AS precio_pase_dia, round(precio_pase_clase)::bigint AS precio_pase_clase
    """),
    ("staff", "staff", "uuid", """
        id, nombre, correo::text AS correo, rol, activo, (deleted_at IS NOT NULL) AS eliminado, password_cambiada_en
    """),
    ("permisos", "permisos_rol", "uuid", "id, rol, submodulo, puede_crear, puede_leer, puede_editar, puede_eliminar"),
    ("planes", "planes", "uuid", "id, nombre, round(precio)::bigint AS precio, duracion_dias, tipo, cupo_personas, activo"),
    ("productos", "productos", "uuid", "id, nombre, round(precio)::bigint AS precio, stock, activo"),
    ("deportistas", "deportistas", "uuid", "id, tipo_documento, documento, nombre, activo, (deleted_at IS NOT NULL) AS eliminado"),
    ("membresias", "membresias", "uuid", "id, deportista_id, plan_id, fecha_inicio, fecha_vencimiento, cancelada, created_at, "
                                         "round(plan_precio_vendido)::bigint AS plan_precio_vendido"),
    ("eliminados", "sync_eliminados", "bigint", "id, tabla, registro_id"),
    # Fase 2 · regla de acceso sin red.
    ("congelamientos", "congelamientos", "uuid", "id, membresia_id, fecha_inicio, fecha_fin"),
    # Un pase de día deja entrar el día en que se pagó. Solo viajan los recientes; si la venta se
    # anula, su marca cambia y vuelve a bajar con `anulada = true`.
    ("pases_dia", "ventas", "uuid", "id, deportista_id, created_at, anulada", """
        AND deportista_id IS NOT NULL
        AND created_at >= now() - interval '2 days'
        AND EXISTS (SELECT 1 FROM platform.venta_items i WHERE i.venta_id = platform.ventas.id AND i.tipo = 'pase_dia')
    """),
]


def _cursor_invalido() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"codigo": "CURSOR_INVALIDO", "mensaje": "El cursor de sincronización no es válido."},
    )


def codificar_cursor(datos: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(datos, separators=(",", ":")).encode()).decode()


def decodificar_cursor(cursor: str) -> dict:
    try:
        datos = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        assert isinstance(datos["e"], str) and isinstance(datos["d"], int) and isinstance(datos["s"], int)
        assert isinstance(datos["t"], int) and 0 <= datos["t"] <= len(_TABLAS)
        assert datos["u"] is None or (isinstance(datos["u"], list) and len(datos["u"]) == 2)
        return datos
    except Exception:
        raise _cursor_invalido()


def _serializar(valor: Any) -> Any:
    if isinstance(valor, UUID):
        return str(valor)
    if isinstance(valor, datetime):
        return valor.astimezone(timezone.utc).isoformat()
    if hasattr(valor, "isoformat"):
        return valor.isoformat()
    return valor


class PullService:
    @staticmethod
    async def _suscripcion(session: AsyncSession, gym_id: UUID) -> Optional[SuscripcionEstacionDto]:
        res = await session.execute(
            text("SELECT estado_guardado, fecha_corte, estado_calculado, motivo_bloqueo FROM platform.estado_suscripcion(:g)"),
            {"g": gym_id},
        )
        fila = res.mappings().first()
        return SuscripcionEstacionDto(**fila) if fila else None

    @classmethod
    async def pull(
        cls, session: AsyncSession, estacion: EstacionAutenticada, cursor: Optional[str], limite: int, version_app: Optional[str]
    ) -> PullResponse:
        gym_id = estacion.gimnasio_id

        res = await session.execute(text("""
            SELECT (SELECT epoca::text FROM platform.sync_epoca) AS epoca,
                   (pg_snapshot_xmin(pg_current_snapshot())::text)::bigint AS xmin,
                   (pg_snapshot_xmax(pg_current_snapshot())::text)::bigint AS xmax
        """))
        marca = res.mappings().one()

        reiniciar = False
        estado = decodificar_cursor(cursor) if cursor else None
        # Otra época, o un cursor más adelantado que el propio servidor (respaldo restaurado):
        # las marcas ya no son comparables y la estación debe descargar todo de nuevo.
        if estado is not None and (estado["e"] != marca["epoca"] or estado["d"] > marca["xmax"]):
            estado, reiniciar = None, True
        if estado is None:
            estado = {"e": marca["epoca"], "d": 0, "s": marca["xmin"], "t": 0, "u": None}
        elif estado["t"] == 0 and estado["u"] is None:
            # Empieza una ronda nueva: se fija hasta dónde es seguro avanzar al terminarla.
            estado["s"] = marca["xmin"]

        cambios: Dict[str, List[dict]] = {nombre: [] for nombre, *_ in _TABLAS}
        restante = limite
        indice, ultimo = estado["t"], estado["u"]

        while indice < len(_TABLAS) and restante > 0:
            nombre, tabla, tipo_id, columnas, *resto = _TABLAS[indice]
            filtro_extra = resto[0] if resto else ""
            filtro_gym = "id = :g" if tabla == "tenant" else "gimnasio_id = :g"
            params: Dict[str, Any] = {"g": gym_id, "desde": estado["d"], "n": restante + 1}
            pagina = ""
            if ultimo is not None:
                pagina = f"AND (sync_xid, id) > (:ux, CAST(:uid AS {tipo_id}))"
                params.update({"ux": ultimo[0], "uid": str(ultimo[1])})
            res = await session.execute(
                text(f"""
                    SELECT {columnas}, sync_xid AS _xid
                    FROM platform.{tabla}
                    WHERE {filtro_gym} AND sync_xid >= :desde {filtro_extra} {pagina}
                    ORDER BY sync_xid, id
                    LIMIT :n
                """),
                params,
            )
            filas = [dict(f) for f in res.mappings().all()]
            hay_mas_en_tabla = len(filas) > restante
            filas = filas[:restante]
            for fila in filas:
                xid = fila.pop("_xid")
                ultimo = [xid, str(fila["id"])]
                cambios[nombre].append({k: _serializar(v) for k, v in fila.items()})
            restante -= len(filas)
            if hay_mas_en_tabla:
                break
            indice, ultimo = indice + 1, None

        termino = indice >= len(_TABLAS)
        siguiente = (
            {"e": estado["e"], "d": estado["s"], "s": estado["s"], "t": 0, "u": None}
            if termino
            else {"e": estado["e"], "d": estado["d"], "s": estado["s"], "t": indice, "u": ultimo}
        )

        await session.execute(
            text("""
                UPDATE platform.estaciones
                SET ultima_sync_en = now(), version_app = COALESCE(:v, version_app)
                WHERE id = :id AND gimnasio_id = :g
            """),
            {"v": version_app, "id": estacion.id, "g": gym_id},
        )

        eliminados = [{"tabla": e["tabla"], "id": e["registro_id"]} for e in cambios.pop("eliminados")]
        return PullResponse(
            epoca=estado["e"],
            reiniciar=reiniciar,
            cursor=codificar_cursor(siguiente),
            hay_mas=not termino,
            cambios=cambios,
            eliminados=eliminados,
            suscripcion=await cls._suscripcion(session, gym_id),
            servidor_ahora=datetime.now(timezone.utc),
        )
