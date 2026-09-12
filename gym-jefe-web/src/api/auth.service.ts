import { apiClient } from './client';
import {
  LoginRequest,
  LoginResponseDto,
  RefreshResponseDto,
  RefreshTokenRequest,
  SolicitarRecuperacionRequest,
  ConfirmarRecuperacionRequest,
  UsuarioAuthDto,
  PermisoMatrizItemDto,
  PermisoItemUpdate,
  ApiResponse,
} from '../types/auth.types';

export const authService = {
  async login(data: LoginRequest): Promise<LoginResponseDto> {
    const response = await apiClient.post<LoginResponseDto>('/auth/login', data);
    return response.data;
  },

  async refresh(data: RefreshTokenRequest): Promise<RefreshResponseDto> {
    const response = await apiClient.post<RefreshResponseDto>('/auth/refresh', data);
    return response.data;
  },

  async logout(refreshToken: string): Promise<ApiResponse> {
    const response = await apiClient.post<ApiResponse>('/auth/logout', { refresh_token: refreshToken });
    return response.data;
  },

  async getMe(): Promise<UsuarioAuthDto> {
    const response = await apiClient.get<UsuarioAuthDto>('/auth/me');
    return response.data;
  },

  async solicitarRecuperacion(data: SolicitarRecuperacionRequest): Promise<ApiResponse> {
    const response = await apiClient.post<ApiResponse>('/auth/recuperar-password/solicitar', data);
    return response.data;
  },

  async confirmarRecuperacion(data: ConfirmarRecuperacionRequest): Promise<ApiResponse> {
    const response = await apiClient.post<ApiResponse>('/auth/recuperar-password/confirmar', data);
    return response.data;
  },

  async getMatrizPermisos(): Promise<PermisoMatrizItemDto[]> {
    const response = await apiClient.get<PermisoMatrizItemDto[]>('/auth/permisos/matriz');
    return response.data;
  },

  async updateMatrizPermisos(permisos: PermisoItemUpdate[]): Promise<PermisoMatrizItemDto[]> {
    const response = await apiClient.put<PermisoMatrizItemDto[]>('/auth/permisos/matriz', { permisos });
    return response.data;
  },
};
