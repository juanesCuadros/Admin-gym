export type RolStaff = 'jefe' | 'recepcionista' | 'entrenador';

export interface UsuarioSesion {
  id: string;
  nombre: string;
  correo: string;
  rol: RolStaff;
  tiene_pin: boolean;
}

export interface EstadoSesion {
  estado: 'sin_sesion' | 'activa' | 'bloqueada';
  usuario: UsuarioSesion | null;
  minutos_inactividad: number;
}

export interface PersonaConPin {
  id: string;
  nombre: string;
}
