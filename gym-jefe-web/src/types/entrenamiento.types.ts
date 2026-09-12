export interface EjercicioResponse {
  id: string;
  gimnasio_id?: string | null;
  propio: boolean;
  nombre_es: string;
  nombre_en?: string | null;
  instrucciones?: string | null;
  grupo_muscular?: string | null;
  equipo?: string | null;
  categoria?: string | null;
  archivo_url?: string | null;
  activo_en_gym: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface EjerciciosPaginadosResponse {
  items: EjercicioResponse[];
  total: number;
  skip: number;
  limit: number;
}

export interface CrearEjercicioPropioRequest {
  nombre_es: string;
  nombre_en?: string;
  instrucciones?: string;
  grupo_muscular?: string;
  equipo?: string;
  categoria?: string;
  archivo_url?: string;
}

export interface RutinaItemInput {
  ejercicio_id: string;
  orden: number;
  series?: number;
  reps?: string;
  peso_sugerido?: string;
  descanso_seg?: number;
}

export interface RutinaItemResponse {
  id: string;
  ejercicio_id: string;
  ejercicio_nombre: string;
  ejercicio_grupo_muscular?: string | null;
  ejercicio_equipo?: string | null;
  ejercicio_archivo_url?: string | null;
  ejercicio_activo_en_gym: boolean;
  orden: number;
  series?: number | null;
  reps?: string | null;
  peso_sugerido?: string | null;
  descanso_seg?: number | null;
}

export interface CrearPlantillaRequest {
  nombre: string;
  descripcion?: string;
  items: RutinaItemInput[];
}

export interface RutinaPlantillaListItemResponse {
  id: string;
  nombre: string;
  descripcion?: string | null;
  entrenador_id?: string | null;
  entrenador_nombre?: string | null;
  total_ejercicios: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RutinaPlantillaResponse {
  id: string;
  nombre: string;
  descripcion?: string | null;
  entrenador_id?: string | null;
  entrenador_nombre?: string | null;
  version: number;
  items: RutinaItemResponse[];
  created_at: string;
  updated_at: string;
}

export interface PlantillasPaginadasResponse {
  items: RutinaPlantillaListItemResponse[];
  total: number;
  skip: number;
  limit: number;
}

export interface AsignarRutinaRequest {
  deportista_id: string;
  plantilla_id?: string;
  nombre?: string;
  items?: RutinaItemInput[];
}

export interface PersonalizarRutinaAsignadaRequest {
  nombre?: string;
  items: RutinaItemInput[];
}

export interface RutinaAsignadaResponse {
  id: string;
  gimnasio_id: string;
  deportista_id: string;
  deportista_nombre?: string | null;
  plantilla_id?: string | null;
  entrenador_id?: string | null;
  entrenador_nombre?: string | null;
  nombre: string;
  activa: boolean;
  asignada_en: string;
  created_at: string;
  items: RutinaItemResponse[];
}
