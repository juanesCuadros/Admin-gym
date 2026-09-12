"""
Servicio de negocio para el Módulo 6: Entrenamiento (RF-28 a RF-31).
Gestiona:
1. Catálogo híbrido de ejercicios (globales y propios con activación por sede y GIF condicional).
2. Plantillas de rutina reutilizables con control de concurrencia optimista.
3. Asignación de rutinas a deportistas como snapshots inmutables (Opción B de personalización).
"""
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit import AuditService
from app.modules.entrenamiento.schemas import (
    AsignarRutinaRequest,
    CambiarEstadoEjercicioRequest,
    CambiarEstadoRutinaAsignadaRequest,
    CrearEjercicioPropioRequest,
    CrearPlantillaRequest,
    EditarEjercicioPropioRequest,
    EditarPlantillaRequest,
    EjercicioResponse,
    EjerciciosPaginadosResponse,
    PersonalizarRutinaAsignadaRequest,
    PlantillasPaginadasResponse,
    RutinaAsignadaResponse,
    RutinaItemResponse,
    RutinaPlantillaListItemResponse,
    RutinaPlantillaResponse,
)


class EntrenamientoService:

    # =========================================================================
    # 1. CATÁLOGO HÍBRIDO DE EJERCICIOS (RF-28)
    # =========================================================================

    @classmethod
    async def listar_ejercicios(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        busqueda: Optional[str] = None,
        grupo_muscular: Optional[str] = None,
        categoria: Optional[str] = None,
        equipo: Optional[str] = None,
        solo_propios: bool = False,
        solo_globales: bool = False,
        solo_activos_sede: Optional[bool] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> EjerciciosPaginadosResponse:
        """
        Consulta el catálogo combinado (globales del Super-Admin + propios del gimnasio).
        Resuelve activo_en_gym y aplica la regla RF-28: Si está desactivado en la sede,
        el archivo_url (GIF) se omite (None).
        """
        clauses = ["(e.gimnasio_id IS NULL OR e.gimnasio_id = :gym_id)"]
        params: Dict[str, Any] = {"gym_id": gym_id, "skip": skip, "limit": limit}

        if busqueda:
            clauses.append("(e.nombre_es ILIKE :busq OR COALESCE(e.nombre_en, '') ILIKE :busq)")
            params["busq"] = f"%{busqueda.strip()}%"

        if grupo_muscular:
            clauses.append("e.grupo_muscular = :grupo_muscular")
            params["grupo_muscular"] = grupo_muscular.strip()

        if categoria:
            clauses.append("e.categoria = :categoria")
            params["categoria"] = categoria.strip()

        if equipo:
            clauses.append("e.equipo = :equipo")
            params["equipo"] = equipo.strip()

        if solo_propios:
            clauses.append("e.propio = true")
        elif solo_globales:
            clauses.append("e.propio = false")

        where_sql = " AND ".join(clauses)

        # Base query con join a activación en sede
        base_from = """
            FROM platform.ejercicios e
            LEFT JOIN platform.gimnasio_ejercicio ge 
                   ON ge.ejercicio_id = e.id AND ge.gimnasio_id = :gym_id
            WHERE """ + where_sql

        # Contar total
        q_count = text(f"SELECT COUNT(*) {base_from}")
        res_count = await session.execute(q_count, params)
        total = res_count.scalar() or 0

        # Filas paginadas
        q_rows = text(f"""
            SELECT e.id, e.gimnasio_id, e.propio, e.nombre_es, e.nombre_en, e.instrucciones,
                   e.grupo_muscular, e.equipo, e.categoria, e.archivo_url, e.activo, e.version,
                   e.created_at, e.updated_at,
                   CASE 
                     WHEN e.propio THEN e.activo
                     ELSE COALESCE(ge.activo_en_gym, true)
                   END as activo_en_gym
            {base_from}
            ORDER BY e.nombre_es ASC
            OFFSET :skip LIMIT :limit
        """)
        res_rows = await session.execute(q_rows, params)

        items: List[EjercicioResponse] = []
        for r in res_rows.mappings().all():
            activo_en_gym = bool(r["activo_en_gym"])
            if solo_activos_sede is not None and activo_en_gym != solo_activos_sede:
                continue

            # Regla RF-28: Un ejercicio desactivado sigue visible, pero sin GIF
            gif_url = r["archivo_url"] if activo_en_gym else None

            items.append(EjercicioResponse(
                id=r["id"],
                gimnasio_id=r["gimnasio_id"],
                propio=r["propio"],
                nombre_es=r["nombre_es"],
                nombre_en=r["nombre_en"],
                instrucciones=r["instrucciones"],
                grupo_muscular=r["grupo_muscular"],
                equipo=r["equipo"],
                categoria=r["categoria"],
                archivo_url=gif_url,
                activo_en_gym=activo_en_gym,
                version=r["version"],
                created_at=r["created_at"],
                updated_at=r["updated_at"]
            ))

        return EjerciciosPaginadosResponse(items=items, total=total, skip=skip, limit=limit)

    @classmethod
    async def crear_ejercicio_propio(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        req: CrearEjercicioPropioRequest,
    ) -> EjercicioResponse:
        """Crea un ejercicio propio del gimnasio (propio = true, gimnasio_id = gym_id)."""
        q = text("""
            INSERT INTO platform.ejercicios (
                gimnasio_id, propio, nombre_es, nombre_en, instrucciones,
                grupo_muscular, equipo, categoria, archivo_url, activo, version
            ) VALUES (
                :gym_id, true, :nombre_es, :nombre_en, :instrucciones,
                :grupo_muscular, :equipo, :categoria, :archivo_url, true, 1
            ) RETURNING id, gimnasio_id, propio, nombre_es, nombre_en, instrucciones,
                        grupo_muscular, equipo, categoria, archivo_url, activo, version,
                        created_at, updated_at
        """)
        try:
            res = await session.execute(q, {
                "gym_id": gym_id,
                "nombre_es": req.nombre_es.strip(),
                "nombre_en": req.nombre_en.strip() if req.nombre_en else None,
                "instrucciones": req.instrucciones,
                "grupo_muscular": req.grupo_muscular,
                "equipo": req.equipo,
                "categoria": req.categoria,
                "archivo_url": req.archivo_url,
            })
            row = res.mappings().one()
        except IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "EJERCICIO_YA_EXISTE", "mensaje": "Conflicto de unicidad al crear el ejercicio"}
            )

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CREAR_EJERCICIO",
            entidad="ejercicios",
            entidad_id=row["id"],
            detalle={"nombre_es": req.nombre_es, "propio": True}
        )

        return EjercicioResponse(**row, activo_en_gym=True)

    @classmethod
    async def obtener_ejercicio(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        ejercicio_id: UUID,
    ) -> EjercicioResponse:
        """Obtiene un ejercicio del catálogo verificando pertenencia o visibilidad global."""
        q = text("""
            SELECT e.id, e.gimnasio_id, e.propio, e.nombre_es, e.nombre_en, e.instrucciones,
                   e.grupo_muscular, e.equipo, e.categoria, e.archivo_url, e.activo, e.version,
                   e.created_at, e.updated_at,
                   CASE 
                     WHEN e.propio THEN e.activo
                     ELSE COALESCE(ge.activo_en_gym, true)
                   END as activo_en_gym
            FROM platform.ejercicios e
            LEFT JOIN platform.gimnasio_ejercicio ge 
                   ON ge.ejercicio_id = e.id AND ge.gimnasio_id = :gym_id
            WHERE e.id = :id AND (e.gimnasio_id IS NULL OR e.gimnasio_id = :gym_id)
        """)
        res = await session.execute(q, {"id": ejercicio_id, "gym_id": gym_id})
        r = res.mappings().first()
        if not r:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "EJERCICIO_NO_ENCONTRADO", "mensaje": "Ejercicio no encontrado"}
            )

        activo_en_gym = bool(r["activo_en_gym"])
        gif_url = r["archivo_url"] if activo_en_gym else None

        return EjercicioResponse(
            id=r["id"],
            gimnasio_id=r["gimnasio_id"],
            propio=r["propio"],
            nombre_es=r["nombre_es"],
            nombre_en=r["nombre_en"],
            instrucciones=r["instrucciones"],
            grupo_muscular=r["grupo_muscular"],
            equipo=r["equipo"],
            categoria=r["categoria"],
            archivo_url=gif_url,
            activo_en_gym=activo_en_gym,
            version=r["version"],
            created_at=r["created_at"],
            updated_at=r["updated_at"]
        )

    @classmethod
    async def editar_ejercicio_propio(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        ejercicio_id: UUID,
        req: EditarEjercicioPropioRequest,
    ) -> EjercicioResponse:
        """Edita un ejercicio propio del gimnasio con control de concurrencia optimista (version)."""
        # Validar si es global
        q_check = text("SELECT propio, gimnasio_id, version FROM platform.ejercicios WHERE id = :id AND (gimnasio_id IS NULL OR gimnasio_id = :gym_id)")
        res_check = await session.execute(q_check, {"id": ejercicio_id, "gym_id": gym_id})
        ej = res_check.mappings().first()
        if not ej:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "EJERCICIO_NO_ENCONTRADO", "mensaje": "Ejercicio no encontrado"}
            )
        if not ej["propio"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"codigo": "EJERCICIO_GLOBAL_NO_EDITABLE", "mensaje": "Los ejercicios del catálogo global son administrados por la plataforma y no pueden ser editados"}
            )

        q_upd = text("""
            UPDATE platform.ejercicios
            SET nombre_es = :nombre_es,
                nombre_en = :nombre_en,
                instrucciones = :instrucciones,
                grupo_muscular = :grupo_muscular,
                equipo = :equipo,
                categoria = :categoria,
                archivo_url = :archivo_url,
                version = version + 1,
                updated_at = now()
            WHERE id = :id AND gimnasio_id = :gym_id AND version = :version
            RETURNING id, gimnasio_id, propio, nombre_es, nombre_en, instrucciones,
                      grupo_muscular, equipo, categoria, archivo_url, activo, version,
                      created_at, updated_at
        """)
        res_upd = await session.execute(q_upd, {
            "id": ejercicio_id,
            "gym_id": gym_id,
            "version": req.version,
            "nombre_es": req.nombre_es.strip(),
            "nombre_en": req.nombre_en.strip() if req.nombre_en else None,
            "instrucciones": req.instrucciones,
            "grupo_muscular": req.grupo_muscular,
            "equipo": req.equipo,
            "categoria": req.categoria,
            "archivo_url": req.archivo_url,
        })
        row = res_upd.mappings().first()
        if not row:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "CONFLICTO_CONCURRENCIA",
                    "mensaje": "El ejercicio fue modificado por otro usuario. Recargue los datos para continuar",
                    "version_actual": ej["version"]
                }
            )

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="EDITAR_EJERCICIO",
            entidad="ejercicios",
            entidad_id=row["id"],
            detalle={"version_nueva": row["version"]}
        )

        return EjercicioResponse(**row, activo_en_gym=row["activo"])

    @classmethod
    async def cambiar_estado_ejercicio(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        ejercicio_id: UUID,
        req: CambiarEstadoEjercicioRequest,
    ) -> EjercicioResponse:
        """
        Activa o desactiva un ejercicio para la sede (RF-28):
        - Si es propio: modifica platform.ejercicios.activo.
        - Si es global: hace UPSERT en platform.gimnasio_ejercicio(gimnasio_id, ejercicio_id, activo_en_gym).
        """
        q_check = text("SELECT id, propio, gimnasio_id FROM platform.ejercicios WHERE id = :id AND (gimnasio_id IS NULL OR gimnasio_id = :gym_id)")
        res_check = await session.execute(q_check, {"id": ejercicio_id, "gym_id": gym_id})
        ej = res_check.mappings().first()
        if not ej:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "EJERCICIO_NO_ENCONTRADO", "mensaje": "Ejercicio no encontrado"}
            )

        if ej["propio"]:
            # Ejercicio propio del gimnasio
            q_upd = text("""
                UPDATE platform.ejercicios
                SET activo = :activo, updated_at = now()
                WHERE id = :id AND gimnasio_id = :gym_id
                RETURNING id, gimnasio_id, propio, nombre_es, nombre_en, instrucciones,
                          grupo_muscular, equipo, categoria, archivo_url, activo, version,
                          created_at, updated_at
            """)
            res_upd = await session.execute(q_upd, {"id": ejercicio_id, "gym_id": gym_id, "activo": req.activo})
            row = res_upd.mappings().one()
            activo_en_gym = row["activo"]
        else:
            # Ejercicio global: UPSERT en gimnasio_ejercicio
            q_upsert = text("""
                INSERT INTO platform.gimnasio_ejercicio (gimnasio_id, ejercicio_id, activo_en_gym)
                VALUES (:gym_id, :ejer_id, :activo)
                ON CONFLICT (gimnasio_id, ejercicio_id)
                DO UPDATE SET activo_en_gym = EXCLUDED.activo_en_gym
            """)
            await session.execute(q_upsert, {"gym_id": gym_id, "ejer_id": ejercicio_id, "activo": req.activo})

            # Leer datos actualizados
            return await cls.obtener_ejercicio(session, gym_id, ejercicio_id)

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CAMBIAR_ESTADO_EJERCICIO",
            entidad="ejercicios",
            entidad_id=row["id"],
            detalle={"activo": req.activo, "propio": ej["propio"]}
        )

        gif_url = row["archivo_url"] if activo_en_gym else None
        return EjercicioResponse(**row, archivo_url=gif_url, activo_en_gym=activo_en_gym)

    # =========================================================================
    # 2. PLANTILLAS DE RUTINA (RF-29)
    # =========================================================================

    @classmethod
    async def crear_plantilla(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        req: CrearPlantillaRequest,
    ) -> RutinaPlantillaResponse:
        """Crea una plantilla de rutina y sus ejercicios ordenados atómicamente."""
        # 1. Validar que todos los ejercicios existen y están disponibles
        ejer_ids = [item.ejercicio_id for item in req.items]
        q_valid = text("""
            SELECT id FROM platform.ejercicios
            WHERE id = ANY(:ids) AND (gimnasio_id IS NULL OR gimnasio_id = :gym_id)
        """)
        res_valid = await session.execute(q_valid, {"ids": ejer_ids, "gym_id": gym_id})
        valid_ids = {r[0] for r in res_valid.fetchall()}
        for eid in ejer_ids:
            if eid not in valid_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "EJERCICIO_NO_DISPONIBLE", "mensaje": f"El ejercicio {eid} no existe o no está disponible en este gimnasio"}
                )

        # 2. Insertar cabecera de plantilla
        q_plantilla = text("""
            INSERT INTO platform.rutinas_plantilla (
                gimnasio_id, entrenador_id, nombre, descripcion, version
            ) VALUES (
                :gym_id, :entrenador_id, :nombre, :descripcion, 1
            ) RETURNING id, gimnasio_id, entrenador_id, nombre, descripcion, version, created_at, updated_at
        """)
        res_p = await session.execute(q_plantilla, {
            "gym_id": gym_id,
            "entrenador_id": staff_id,
            "nombre": req.nombre.strip(),
            "descripcion": req.descripcion.strip() if req.descripcion else None,
        })
        plantilla = res_p.mappings().one()

        # 3. Insertar items ordenados
        q_item = text("""
            INSERT INTO platform.rutina_plantilla_items (
                gimnasio_id, plantilla_id, ejercicio_id, orden, series, reps, peso_sugerido, descanso_seg
            ) VALUES (
                :gym_id, :plantilla_id, :ejer_id, :orden, :series, :reps, :peso, :descanso
            ) RETURNING id, ejercicio_id, orden, series, reps, peso_sugerido, descanso_seg
        """)
        for idx, item in enumerate(req.items):
            await session.execute(q_item, {
                "gym_id": gym_id,
                "plantilla_id": plantilla["id"],
                "ejer_id": item.ejercicio_id,
                "orden": item.orden if item.orden is not None else idx,
                "series": item.series,
                "reps": item.reps,
                "peso": item.peso_sugerido,
                "descanso": item.descanso_seg,
            })

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CREAR_PLANTILLA_RUTINA",
            entidad="rutinas_plantilla",
            entidad_id=plantilla["id"],
            detalle={"nombre": req.nombre, "total_items": len(req.items)}
        )

        return await cls.obtener_plantilla(session, gym_id, plantilla["id"])

    @classmethod
    async def listar_plantillas(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        busqueda: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> PlantillasPaginadasResponse:
        """Lista plantillas de rutina del gimnasio con conteo de ejercicios."""
        clauses = ["p.gimnasio_id = :gym_id"]
        params: Dict[str, Any] = {"gym_id": gym_id, "skip": skip, "limit": limit}

        if busqueda:
            clauses.append("(p.nombre ILIKE :busq OR COALESCE(p.descripcion, '') ILIKE :busq)")
            params["busq"] = f"%{busqueda.strip()}%"

        where_sql = " AND ".join(clauses)

        q_count = text(f"SELECT COUNT(*) FROM platform.rutinas_plantilla p WHERE {where_sql}")
        res_count = await session.execute(q_count, params)
        total = res_count.scalar() or 0

        q_rows = text(f"""
            SELECT p.id, p.nombre, p.descripcion, p.entrenador_id, s.nombre as entrenador_nombre,
                   p.version, p.created_at, p.updated_at,
                   COUNT(i.id) as total_ejercicios
            FROM platform.rutinas_plantilla p
            LEFT JOIN platform.staff s ON s.id = p.entrenador_id
            LEFT JOIN platform.rutina_plantilla_items i ON i.plantilla_id = p.id
            WHERE {where_sql}
            GROUP BY p.id, s.nombre
            ORDER BY p.nombre ASC
            OFFSET :skip LIMIT :limit
        """)
        res_rows = await session.execute(q_rows, params)

        items = [RutinaPlantillaListItemResponse(**r) for r in res_rows.mappings().all()]
        return PlantillasPaginadasResponse(items=items, total=total, skip=skip, limit=limit)

    @classmethod
    async def obtener_plantilla(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        plantilla_id: UUID,
    ) -> RutinaPlantillaResponse:
        """Obtiene una plantilla con sus items expandidos y regla de GIF."""
        q_p = text("""
            SELECT p.id, p.nombre, p.descripcion, p.entrenador_id, s.nombre as entrenador_nombre,
                   p.version, p.created_at, p.updated_at
            FROM platform.rutinas_plantilla p
            LEFT JOIN platform.staff s ON s.id = p.entrenador_id
            WHERE p.id = :id AND p.gimnasio_id = :gym_id
        """)
        res_p = await session.execute(q_p, {"id": plantilla_id, "gym_id": gym_id})
        p = res_p.mappings().first()
        if not p:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PLANTILLA_NO_ENCONTRADA", "mensaje": "Plantilla de rutina no encontrada"}
            )

        q_items = text("""
            SELECT i.id, i.ejercicio_id, e.nombre_es as ejercicio_nombre,
                   e.grupo_muscular as ejercicio_grupo_muscular, e.equipo as ejercicio_equipo,
                   e.archivo_url as ejercicio_archivo_url,
                   CASE 
                     WHEN e.propio THEN e.activo
                     ELSE COALESCE(ge.activo_en_gym, true)
                   END as ejercicio_activo_en_gym,
                   i.orden, i.series, i.reps, i.peso_sugerido, i.descanso_seg
            FROM platform.rutina_plantilla_items i
            JOIN platform.ejercicios e ON e.id = i.ejercicio_id
            LEFT JOIN platform.gimnasio_ejercicio ge 
                   ON ge.ejercicio_id = e.id AND ge.gimnasio_id = :gym_id
            WHERE i.plantilla_id = :p_id AND i.gimnasio_id = :gym_id
            ORDER BY i.orden ASC, i.id ASC
        """)
        res_items = await session.execute(q_items, {"p_id": plantilla_id, "gym_id": gym_id})

        items: List[RutinaItemResponse] = []
        for r in res_items.mappings().all():
            activo_en_gym = bool(r["ejercicio_activo_en_gym"])
            # Regla RF-28: Si está desactivado, omitir GIF
            gif_url = r["ejercicio_archivo_url"] if activo_en_gym else None

            items.append(RutinaItemResponse(
                id=r["id"],
                ejercicio_id=r["ejercicio_id"],
                ejercicio_nombre=r["ejercicio_nombre"],
                ejercicio_grupo_muscular=r["ejercicio_grupo_muscular"],
                ejercicio_equipo=r["ejercicio_equipo"],
                ejercicio_archivo_url=gif_url,
                ejercicio_activo_en_gym=activo_en_gym,
                orden=r["orden"],
                series=r["series"],
                reps=r["reps"],
                peso_sugerido=r["peso_sugerido"],
                descanso_seg=r["descanso_seg"],
            ))

        return RutinaPlantillaResponse(**p, items=items)

    @classmethod
    async def editar_plantilla(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        plantilla_id: UUID,
        req: EditarPlantillaRequest,
    ) -> RutinaPlantillaResponse:
        """Actualiza la plantilla y sus items con control de concurrencia optimista (version)."""
        # 1. Validar que la plantilla existe y verificar versión
        q_ver = text("SELECT version FROM platform.rutinas_plantilla WHERE id = :id AND gimnasio_id = :gym_id")
        res_ver = await session.execute(q_ver, {"id": plantilla_id, "gym_id": gym_id})
        p_row = res_ver.mappings().first()
        if not p_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PLANTILLA_NO_ENCONTRADA", "mensaje": "Plantilla de rutina no encontrada"}
            )
        if p_row["version"] != req.version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "codigo": "CONFLICTO_CONCURRENCIA",
                    "mensaje": "La plantilla fue modificada por otro usuario. Recargue los datos para continuar",
                    "version_actual": p_row["version"]
                }
            )

        # 2. Validar que todos los ejercicios existen
        ejer_ids = [item.ejercicio_id for item in req.items]
        q_valid = text("""
            SELECT id FROM platform.ejercicios
            WHERE id = ANY(:ids) AND (gimnasio_id IS NULL OR gimnasio_id = :gym_id)
        """)
        res_valid = await session.execute(q_valid, {"ids": ejer_ids, "gym_id": gym_id})
        valid_ids = {r[0] for r in res_valid.fetchall()}
        for eid in ejer_ids:
            if eid not in valid_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "EJERCICIO_NO_DISPONIBLE", "mensaje": f"El ejercicio {eid} no está disponible en este gimnasio"}
                )

        # 3. Actualizar cabecera e incrementar versión
        q_upd = text("""
            UPDATE platform.rutinas_plantilla
            SET nombre = :nombre,
                descripcion = :descripcion,
                version = version + 1,
                updated_at = now()
            WHERE id = :id AND gimnasio_id = :gym_id AND version = :version
            RETURNING version
        """)
        res_upd = await session.execute(q_upd, {
            "id": plantilla_id,
            "gym_id": gym_id,
            "version": req.version,
            "nombre": req.nombre.strip(),
            "descripcion": req.descripcion.strip() if req.descripcion else None,
        })
        if not res_upd.mappings().first():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"codigo": "CONFLICTO_CONCURRENCIA", "mensaje": "Conflicto concurrente al actualizar la plantilla"}
            )

        # 4. Reemplazar items atómicamente
        await session.execute(
            text("DELETE FROM platform.rutina_plantilla_items WHERE plantilla_id = :id AND gimnasio_id = :gym_id"),
            {"id": plantilla_id, "gym_id": gym_id}
        )

        q_item = text("""
            INSERT INTO platform.rutina_plantilla_items (
                gimnasio_id, plantilla_id, ejercicio_id, orden, series, reps, peso_sugerido, descanso_seg
            ) VALUES (
                :gym_id, :plantilla_id, :ejer_id, :orden, :series, :reps, :peso, :descanso
            )
        """)
        for idx, item in enumerate(req.items):
            await session.execute(q_item, {
                "gym_id": gym_id,
                "plantilla_id": plantilla_id,
                "ejer_id": item.ejercicio_id,
                "orden": item.orden if item.orden is not None else idx,
                "series": item.series,
                "reps": item.reps,
                "peso": item.peso_sugerido,
                "descanso": item.descanso_seg,
            })

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="EDITAR_PLANTILLA_RUTINA",
            entidad="rutinas_plantilla",
            entidad_id=plantilla_id,
            detalle={"version_nueva": p_row["version"] + 1, "total_items": len(req.items)}
        )

        return await cls.obtener_plantilla(session, gym_id, plantilla_id)

    @classmethod
    async def eliminar_plantilla(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        plantilla_id: UUID,
    ) -> Dict[str, Any]:
        """
        Elimina una plantilla de rutina.
        INMUTABILIDAD DE SNAPSHOT: Las rutinas asignadas previamente NO se eliminan ni alteran;
        su columna plantilla_id pasa automáticamente a NULL por la FK ON DELETE SET NULL.
        """
        q_find = text("SELECT id, nombre FROM platform.rutinas_plantilla WHERE id = :id AND gimnasio_id = :gym_id")
        res_find = await session.execute(q_find, {"id": plantilla_id, "gym_id": gym_id})
        p = res_find.mappings().first()
        if not p:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "PLANTILLA_NO_ENCONTRADA", "mensaje": "Plantilla no encontrada"}
            )

        q_del = text("DELETE FROM platform.rutinas_plantilla WHERE id = :id AND gimnasio_id = :gym_id")
        await session.execute(q_del, {"id": plantilla_id, "gym_id": gym_id})

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="ELIMINAR_PLANTILLA_RUTINA",
            entidad="rutinas_plantilla",
            entidad_id=plantilla_id,
            detalle={"nombre_eliminado": p["nombre"]}
        )

        return {"mensaje": "Plantilla eliminada exitosamente", "plantilla_id": str(plantilla_id)}

    # =========================================================================
    # 3. ASIGNACIÓN DE RUTINAS COMO SNAPSHOT INMUTABLE (RF-30, RF-31)
    # =========================================================================

    @classmethod
    async def asignar_rutina(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        req: AsignarRutinaRequest,
    ) -> RutinaAsignadaResponse:
        """
        Asigna una rutina a un deportista generando un SNAPSHOT CONGELADO e INMUTABLE.
        Copia todos los items a platform.rutina_asignada_items.
        Permite múltiples rutinas asignadas por deportista (RF-30).
        """
        # 1. Validar y bloquear deportista
        q_dep = text("SELECT id, nombre, activo FROM platform.deportistas WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL FOR UPDATE")
        res_dep = await session.execute(q_dep, {"id": req.deportista_id, "gym_id": gym_id})
        dep = res_dep.mappings().first()
        if not dep:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado"}
            )

        nombre_rutina = req.nombre
        items_a_insertar = []

        # 2. Origen desde plantilla o ad-hoc
        if req.plantilla_id:
            q_p = text("SELECT id, nombre FROM platform.rutinas_plantilla WHERE id = :id AND gimnasio_id = :gym_id")
            res_p = await session.execute(q_p, {"id": req.plantilla_id, "gym_id": gym_id})
            plantilla = res_p.mappings().first()
            if not plantilla:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail={"codigo": "PLANTILLA_NO_ENCONTRADA", "mensaje": "Plantilla de rutina no encontrada"}
                )
            if not nombre_rutina:
                nombre_rutina = plantilla["nombre"]

            if req.items is not None and len(req.items) > 0:
                items_a_insertar = req.items
            else:
                # Copiar items de la plantilla
                q_p_items = text("""
                    SELECT ejercicio_id, orden, series, reps, peso_sugerido, descanso_seg
                    FROM platform.rutina_plantilla_items
                    WHERE plantilla_id = :p_id AND gimnasio_id = :gym_id
                    ORDER BY orden ASC, id ASC
                """)
                res_pi = await session.execute(q_p_items, {"p_id": req.plantilla_id, "gym_id": gym_id})
                items_a_insertar = [dict(r) for r in res_pi.mappings().all()]
        else:
            if not nombre_rutina:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "NOMBRE_REQUERIDO", "mensaje": "El nombre de la rutina es requerido si no proviene de plantilla"}
                )
            if not req.items or len(req.items) == 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"codigo": "ITEMS_REQUERIDOS", "mensaje": "Debe especificar al menos un ejercicio para la rutina"}
                )
            items_a_insertar = req.items

        if not items_a_insertar:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"codigo": "RUTINA_SIN_ITEMS", "mensaje": "La plantilla seleccionada no contiene ejercicios para asignar"}
            )

        # 3. Crear cabecera de rutina asignada
        q_ins_asig = text("""
            INSERT INTO platform.rutinas_asignadas (
                gimnasio_id, deportista_id, plantilla_id, entrenador_id, nombre, asignada_en, activa
            ) VALUES (
                :gym_id, :dep_id, :plantilla_id, :staff_id, :nombre, now(), true
            ) RETURNING id, gimnasio_id, deportista_id, plantilla_id, entrenador_id, nombre, asignada_en, activa, created_at
        """)
        res_asig = await session.execute(q_ins_asig, {
            "gym_id": gym_id,
            "dep_id": req.deportista_id,
            "plantilla_id": req.plantilla_id,
            "staff_id": staff_id,
            "nombre": nombre_rutina.strip(),
        })
        asig = res_asig.mappings().one()

        # 4. Insertar snapshot congelado de items
        q_ins_item = text("""
            INSERT INTO platform.rutina_asignada_items (
                gimnasio_id, rutina_asignada_id, ejercicio_id, orden, series, reps, peso_sugerido, descanso_seg
            ) VALUES (
                :gym_id, :asig_id, :ejer_id, :orden, :series, :reps, :peso, :descanso
            )
        """)
        for idx, item in enumerate(items_a_insertar):
            e_id = item.ejercicio_id if hasattr(item, "ejercicio_id") else item["ejercicio_id"]
            orden = (item.orden if hasattr(item, "orden") else item.get("orden")) or idx
            series = item.series if hasattr(item, "series") else item.get("series")
            reps = item.reps if hasattr(item, "reps") else item.get("reps")
            peso = item.peso_sugerido if hasattr(item, "peso_sugerido") else item.get("peso_sugerido")
            descanso = item.descanso_seg if hasattr(item, "descanso_seg") else item.get("descanso_seg")

            await session.execute(q_ins_item, {
                "gym_id": gym_id,
                "asig_id": asig["id"],
                "ejer_id": e_id,
                "orden": orden,
                "series": series,
                "reps": reps,
                "peso": peso,
                "descanso": descanso,
            })

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="ASIGNAR_RUTINA",
            entidad="rutinas_asignadas",
            entidad_id=asig["id"],
            detalle={
                "deportista_id": str(req.deportista_id),
                "deportista_nombre": dep["nombre"],
                "rutina_nombre": nombre_rutina,
                "plantilla_id": str(req.plantilla_id) if req.plantilla_id else None,
                "total_ejercicios": len(items_a_insertar)
            }
        )

        return await cls.obtener_rutina_asignada(session, gym_id, asig["id"])

    @classmethod
    async def personalizar_rutina_asignada(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        rutina_asignada_id: UUID,
        req: PersonalizarRutinaAsignadaRequest,
    ) -> RutinaAsignadaResponse:
        """
        OPCIÓN B (Snapshot Inmutable + Historial):
        1. Bloquea la rutina asignada previa.
        2. Marca la rutina previa como activa = false.
        3. Crea una NUEVA fila en platform.rutinas_asignadas con los items modificados.
        4. Preserva ambas en el historial completo de entrenamientos del deportista.
        """
        # 1. Bloquear y validar rutina previa
        q_curr = text("""
            SELECT id, deportista_id, plantilla_id, nombre, activa
            FROM platform.rutinas_asignadas
            WHERE id = :id AND gimnasio_id = :gym_id
            FOR UPDATE
        """)
        res_curr = await session.execute(q_curr, {"id": rutina_asignada_id, "gym_id": gym_id})
        curr = res_curr.mappings().first()
        if not curr:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "RUTINA_ASIGNADA_NO_ENCONTRADA", "mensaje": "Rutina asignada no encontrada"}
            )

        # 2. Desactivar rutina previa
        await session.execute(
            text("UPDATE platform.rutinas_asignadas SET activa = false WHERE id = :id"),
            {"id": rutina_asignada_id}
        )

        # 3. Crear nueva rutina personalizada
        nuevo_nombre = req.nombre.strip() if req.nombre else f"{curr['nombre']} (Personalizada)"
        q_ins = text("""
            INSERT INTO platform.rutinas_asignadas (
                gimnasio_id, deportista_id, plantilla_id, entrenador_id, nombre, asignada_en, activa
            ) VALUES (
                :gym_id, :dep_id, :plantilla_id, :staff_id, :nombre, now(), true
            ) RETURNING id, gimnasio_id, deportista_id, plantilla_id, entrenador_id, nombre, asignada_en, activa, created_at
        """)
        res_ins = await session.execute(q_ins, {
            "gym_id": gym_id,
            "dep_id": curr["deportista_id"],
            "plantilla_id": curr["plantilla_id"],
            "staff_id": staff_id,
            "nombre": nuevo_nombre,
        })
        nueva_asig = res_ins.mappings().one()

        # 4. Insertar nuevos items del snapshot
        q_ins_item = text("""
            INSERT INTO platform.rutina_asignada_items (
                gimnasio_id, rutina_asignada_id, ejercicio_id, orden, series, reps, peso_sugerido, descanso_seg
            ) VALUES (
                :gym_id, :asig_id, :ejer_id, :orden, :series, :reps, :peso, :descanso
            )
        """)
        for idx, item in enumerate(req.items):
            await session.execute(q_ins_item, {
                "gym_id": gym_id,
                "asig_id": nueva_asig["id"],
                "ejer_id": item.ejercicio_id,
                "orden": item.orden if item.orden is not None else idx,
                "series": item.series,
                "reps": item.reps,
                "peso": item.peso_sugerido,
                "descanso": item.descanso_seg,
            })

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="PERSONALIZAR_RUTINA_ASIGNADA",
            entidad="rutinas_asignadas",
            entidad_id=nueva_asig["id"],
            detalle={
                "rutina_anterior_id": str(rutina_asignada_id),
                "nueva_rutina_id": str(nueva_asig["id"]),
                "deportista_id": str(curr["deportista_id"]),
                "total_items": len(req.items)
            }
        )

        return await cls.obtener_rutina_asignada(session, gym_id, nueva_asig["id"])

    @classmethod
    async def obtener_rutina_asignada(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        rutina_asignada_id: UUID,
    ) -> RutinaAsignadaResponse:
        """Obtiene el snapshot completo de una rutina asignada con sus items congelados."""
        q_asig = text("""
            SELECT ra.id, ra.gimnasio_id, ra.deportista_id, d.nombre as deportista_nombre,
                   ra.plantilla_id, ra.entrenador_id, s.nombre as entrenador_nombre,
                   ra.nombre, ra.activa, ra.asignada_en, ra.created_at
            FROM platform.rutinas_asignadas ra
            JOIN platform.deportistas d ON d.id = ra.deportista_id
            LEFT JOIN platform.staff s ON s.id = ra.entrenador_id
            WHERE ra.id = :id AND ra.gimnasio_id = :gym_id
        """)
        res_asig = await session.execute(q_asig, {"id": rutina_asignada_id, "gym_id": gym_id})
        asig = res_asig.mappings().first()
        if not asig:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "RUTINA_ASIGNADA_NO_ENCONTRADA", "mensaje": "Rutina asignada no encontrada"}
            )

        q_items = text("""
            SELECT i.id, i.ejercicio_id, e.nombre_es as ejercicio_nombre,
                   e.grupo_muscular as ejercicio_grupo_muscular, e.equipo as ejercicio_equipo,
                   e.archivo_url as ejercicio_archivo_url,
                   CASE 
                     WHEN e.propio THEN e.activo
                     ELSE COALESCE(ge.activo_en_gym, true)
                   END as ejercicio_activo_en_gym,
                   i.orden, i.series, i.reps, i.peso_sugerido, i.descanso_seg
            FROM platform.rutina_asignada_items i
            JOIN platform.ejercicios e ON e.id = i.ejercicio_id
            LEFT JOIN platform.gimnasio_ejercicio ge 
                   ON ge.ejercicio_id = e.id AND ge.gimnasio_id = :gym_id
            WHERE i.rutina_asignada_id = :r_id AND i.gimnasio_id = :gym_id
            ORDER BY i.orden ASC, i.id ASC
        """)
        res_items = await session.execute(q_items, {"r_id": rutina_asignada_id, "gym_id": gym_id})

        items: List[RutinaItemResponse] = []
        for r in res_items.mappings().all():
            activo_en_gym = bool(r["ejercicio_activo_en_gym"])
            gif_url = r["ejercicio_archivo_url"] if activo_en_gym else None

            items.append(RutinaItemResponse(
                id=r["id"],
                ejercicio_id=r["ejercicio_id"],
                ejercicio_nombre=r["ejercicio_nombre"],
                ejercicio_grupo_muscular=r["ejercicio_grupo_muscular"],
                ejercicio_equipo=r["ejercicio_equipo"],
                ejercicio_archivo_url=gif_url,
                ejercicio_activo_en_gym=activo_en_gym,
                orden=r["orden"],
                series=r["series"],
                reps=r["reps"],
                peso_sugerido=r["peso_sugerido"],
                descanso_seg=r["descanso_seg"],
            ))

        return RutinaAsignadaResponse(**asig, items=items)

    @classmethod
    async def listar_rutinas_deportista(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        deportista_id: UUID,
        solo_activas: bool = False,
    ) -> List[RutinaAsignadaResponse]:
        """Consulta qué rutinas tiene asignadas un deportista (RF-31)."""
        # Validar existencia de deportista
        q_dep = text("SELECT id FROM platform.deportistas WHERE id = :id AND gimnasio_id = :gym_id AND deleted_at IS NULL")
        res_dep = await session.execute(q_dep, {"id": deportista_id, "gym_id": gym_id})
        if not res_dep.mappings().first():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "DEPORTISTA_NO_ENCONTRADO", "mensaje": "Deportista no encontrado"}
            )

        clauses = ["ra.deportista_id = :dep_id", "ra.gimnasio_id = :gym_id"]
        params: Dict[str, Any] = {"dep_id": deportista_id, "gym_id": gym_id}
        if solo_activas:
            clauses.append("ra.activa = true")

        q_list = text(f"""
            SELECT ra.id
            FROM platform.rutinas_asignadas ra
            WHERE {" AND ".join(clauses)}
            ORDER BY ra.activa DESC, ra.asignada_en DESC
        """)
        res_list = await session.execute(q_list, params)
        rutinas_ids = [r[0] for r in res_list.fetchall()]

        resultado: List[RutinaAsignadaResponse] = []
        for r_id in rutinas_ids:
            resultado.append(await cls.obtener_rutina_asignada(session, gym_id, r_id))

        return resultado

    @classmethod
    async def cambiar_estado_rutina_asignada(
        cls,
        session: AsyncSession,
        gym_id: UUID,
        staff_id: UUID,
        staff_nombre: str,
        rutina_asignada_id: UUID,
        req: CambiarEstadoRutinaAsignadaRequest,
    ) -> RutinaAsignadaResponse:
        """Activa o desactiva (archiva) una rutina asignada a un deportista."""
        q_upd = text("""
            UPDATE platform.rutinas_asignadas
            SET activa = :activa
            WHERE id = :id AND gimnasio_id = :gym_id
            RETURNING id
        """)
        res = await session.execute(q_upd, {"id": rutina_asignada_id, "gym_id": gym_id, "activa": req.activa})
        if not res.mappings().first():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"codigo": "RUTINA_ASIGNADA_NO_ENCONTRADA", "mensaje": "Rutina asignada no encontrada"}
            )

        await AuditService.registrar(
            session=session,
            gimnasio_id=gym_id,
            actor_id=staff_id,
            actor_nombre=staff_nombre,
            accion="CAMBIAR_ESTADO_RUTINA_ASIGNADA",
            entidad="rutinas_asignadas",
            entidad_id=rutina_asignada_id,
            detalle={"activa": req.activa}
        )

        return await cls.obtener_rutina_asignada(session, gym_id, rutina_asignada_id)
