import { aErrorApi, cliente } from './cliente'
import type {
  InfoEnlaceRegistro, PlanPublico, RegistroConfirmado, RespuestaMensaje, SolicitudRegistro,
  SubdominioSugerido,
} from '@/types/publico.types'

/** Endpoints públicos de super-admin-api (contrato 3.2). Todos lanzan ErrorApi. */
export const publicoService = {
  async listarPlanes(): Promise<PlanPublico[]> {
    try {
      const { data } = await cliente.get<PlanPublico[]>('/public/plans')
      return Array.isArray(data) ? data : []
    } catch (e) {
      throw aErrorApi(e)
    }
  },

  async sugerirSubdominio(nombre: string, signal?: AbortSignal): Promise<SubdominioSugerido> {
    try {
      const { data } = await cliente.get<SubdominioSugerido>('/public/subdomain-check', {
        params: { nombre },
        signal,
      })
      return data
    } catch (e) {
      throw aErrorApi(e)
    }
  },

  async registrar(solicitud: SolicitudRegistro): Promise<RespuestaMensaje> {
    try {
      const { data } = await cliente.post<RespuestaMensaje>('/public/signup', solicitud)
      return data
    } catch (e) {
      throw aErrorApi(e)
    }
  },

  async consultarEnlace(token: string): Promise<InfoEnlaceRegistro> {
    try {
      const { data } = await cliente.get<InfoEnlaceRegistro>(`/public/signup/${encodeURIComponent(token)}`)
      return data
    } catch (e) {
      throw aErrorApi(e)
    }
  },

  async confirmar(token: string, password: string): Promise<RegistroConfirmado> {
    try {
      const { data } = await cliente.post<RegistroConfirmado>(
        `/public/signup/${encodeURIComponent(token)}/confirm`,
        { password },
      )
      return data
    } catch (e) {
      throw aErrorApi(e)
    }
  },
}
