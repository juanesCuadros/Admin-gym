export interface Exercise {
  id: string;
  propio: boolean;
  nombre_es: string;
  nombre_en?: string | null;
  instrucciones?: string | null;
  grupo_muscular?: string | null;
  equipo?: string | null;
  categoria?: string | null;
  archivo_url?: string | null;
  activo: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ExerciseCreate {
  nombre_es: string;
  nombre_en?: string;
  instrucciones?: string;
  grupo_muscular?: string;
  equipo?: string;
  categoria?: string;
  archivo_url?: string;
  activo?: boolean;
}

export interface ExerciseUpdate {
  nombre_es?: string;
  nombre_en?: string;
  instrucciones?: string;
  grupo_muscular?: string;
  equipo?: string;
  categoria?: string;
  archivo_url?: string;
  activo?: boolean;
}

export interface ExerciseDatasetItem {
  nombre_es: string;
  nombre_en?: string;
  instrucciones?: string;
  grupo_muscular?: string;
  equipo?: string;
  categoria?: string;
  archivo_url?: string;
}

export interface ExerciseImportRequest {
  dataset_nombre: string;
  ejercicios: ExerciseDatasetItem[];
  modo_actualizacion: boolean;
}

export interface ExerciseImportResponse {
  dataset: string;
  total: number;
  insertados: number;
  actualizados: number;
  ignorados: number;
  mensaje: string;
}
