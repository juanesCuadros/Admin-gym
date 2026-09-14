export interface LoginRequest {
  correo: string;
  password: string;
}

export interface UsuarioInterno {
  id: string;
  nombre: string;
  correo: string;
  rol: string;
  activo: boolean;
  ultimo_ingreso?: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in_minutes: number;
  usuario: UsuarioInterno;
}

export interface PasswordRecoveryRequest {
  correo: string;
}

export interface PasswordResetRequest {
  token: string;
  nueva_password: string;
}

export interface MessageResponse {
  mensaje: string;
}
