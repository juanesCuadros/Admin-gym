export interface UsuarioAuthDto {
  id: string;
  nombre: string;
  correo: string;
  rol: 'jefe' | 'recepcionista' | 'entrenador';
  gimnasio_id: string;
  subdominio: string;
  permisos: string[]; // ["*"] o ["submodulo:accion"] ej: ["caja:crear", "caja:leer"]
}

export interface LoginRequest {
  subdominio: string;
  correo: string;
  password: string;
}

export interface LoginResponseDto {
  access_token: string;
  refresh_token: string;
  token_type: string;
  usuario: UsuarioAuthDto;
}

export interface RefreshResponseDto {
  access_token: string;
  token_type: string;
  usuario: UsuarioAuthDto;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface SolicitarRecuperacionRequest {
  subdominio: string;
  correo: string;
}

export interface ConfirmarRecuperacionRequest {
  token: string;
  nueva_password: string;
}

export interface PermisoItemUpdate {
  rol: 'recepcionista' | 'entrenador';
  submodulo: string;
  puede_crear: boolean;
  puede_leer: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
}

export interface PermisoMatrizItemDto {
  rol: 'jefe' | 'recepcionista' | 'entrenador';
  submodulo: string;
  puede_crear: boolean;
  puede_leer: boolean;
  puede_editar: boolean;
  puede_eliminar: boolean;
}

export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
}
