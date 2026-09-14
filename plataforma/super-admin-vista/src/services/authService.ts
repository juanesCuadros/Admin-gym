import { apiClient, setStoredToken, removeStoredToken } from './api/apiClient';
import {
  LoginRequest,
  TokenResponse,
  UsuarioInterno,
  PasswordRecoveryRequest,
  PasswordResetRequest,
  MessageResponse,
} from '@/types/auth.types';

export const authService = {
  async login(data: LoginRequest): Promise<TokenResponse> {
    const response = await apiClient.post<TokenResponse>('/auth/login', data);
    if (response.data.access_token) {
      setStoredToken(response.data.access_token);
      localStorage.setItem('gymos_superadmin_user', JSON.stringify(response.data.usuario));
    }
    return response.data;
  },

  async getMe(): Promise<UsuarioInterno> {
    const response = await apiClient.get<UsuarioInterno>('/auth/me');
    localStorage.setItem('gymos_superadmin_user', JSON.stringify(response.data));
    return response.data;
  },

  async logout(): Promise<MessageResponse> {
    try {
      const response = await apiClient.post<MessageResponse>('/auth/logout');
      return response.data;
    } finally {
      removeStoredToken();
    }
  },

  async requestRecovery(data: PasswordRecoveryRequest): Promise<MessageResponse> {
    const response = await apiClient.post<MessageResponse>('/auth/recovery', data);
    return response.data;
  },

  async resetPassword(data: PasswordResetRequest): Promise<MessageResponse> {
    const response = await apiClient.post<MessageResponse>('/auth/reset-password', data);
    return response.data;
  },
};
