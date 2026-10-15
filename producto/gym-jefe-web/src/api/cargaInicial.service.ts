import { apiClient } from './client';
import type {
  AplicacionCargaResponse,
  FormatoPlantilla,
  SimulacionCargaResponse,
} from '../types/cargaInicial.types';

// El cliente usa JSON por defecto: con FormData axios convertiría el archivo en JSON. Con multipart el
// navegador pone el boundary. Un archivo grande puede tardar más que el tiempo de espera general.
const OPCIONES_ARCHIVO = { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 };

/** Carga inicial de clientes (`/carga-inicial`, contrato 2.4). Solo el Jefe. */
export const cargaInicialService = {
  async descargarPlantilla(formato: FormatoPlantilla): Promise<Blob> {
    const res = await apiClient.get('/carga-inicial/plantilla', { params: { formato }, responseType: 'blob' });
    return res.data as Blob;
  },

  /** Valida el archivo y devuelve los errores por fila. No guarda nada. */
  async simular(archivo: File): Promise<SimulacionCargaResponse> {
    const datos = new FormData();
    datos.append('archivo', archivo);
    const res = await apiClient.post<SimulacionCargaResponse>('/carga-inicial/simular', datos, OPCIONES_ARCHIVO);
    return res.data;
  },

  /** Carga todo o nada. `422 CARGA_CON_ERRORES` trae en `detalles` el mismo formato de `simular`. */
  async aplicar(archivo: File, declaraConsentimientos: boolean): Promise<AplicacionCargaResponse> {
    const datos = new FormData();
    datos.append('archivo', archivo);
    datos.append('declara_consentimientos', declaraConsentimientos ? 'true' : 'false');
    const res = await apiClient.post<AplicacionCargaResponse>('/carga-inicial/aplicar', datos, OPCIONES_ARCHIVO);
    return res.data;
  },
};
