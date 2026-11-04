import type { RegistrarMedicionRequest } from '../../types/deportistas.types';

export type CampoMedicion = keyof Omit<RegistrarMedicionRequest, 'fecha' | 'sexo' | 'altura_cm'>;

/** Formulario vacío de una medición (GW-RF-21): texto por campo, vacío = no se toma. */
export const MEDICION_VACIA: Record<CampoMedicion, string> = {
  peso: '',
  grasa_pct: '',
  masa_muscular: '',
  cintura: '',
  cadera: '',
  brazo: '',
  pierna: '',
  pecho: '',
};

export const ETIQUETAS_MEDICION: Record<CampoMedicion, string> = {
  peso: 'Peso (kg)',
  grasa_pct: '% grasa',
  masa_muscular: 'Músculo (kg)',
  cintura: 'Cintura (cm)',
  cadera: 'Cadera (cm)',
  brazo: 'Brazo (cm)',
  pierna: 'Pierna (cm)',
  pecho: 'Pecho (cm)',
};

export const UNIDAD_MEDICION: Record<CampoMedicion, string> = {
  peso: 'kg',
  grasa_pct: '%',
  masa_muscular: 'kg',
  cintura: 'cm',
  cadera: 'cm',
  brazo: 'cm',
  pierna: 'cm',
  pecho: 'cm',
};

export const CAMPOS_MEDICION = Object.keys(MEDICION_VACIA) as CampoMedicion[];

/** Convierte el formulario en la petición; `null` si no se escribió ninguna medida. */
export function formularioAMedicion(form: Record<CampoMedicion, string>): RegistrarMedicionRequest | null {
  const data: RegistrarMedicionRequest = {};
  for (const k of CAMPOS_MEDICION) {
    if (form[k].trim() !== '') (data as Record<string, number>)[k] = Number(form[k]);
  }
  return Object.keys(data).length === 0 ? null : data;
}
