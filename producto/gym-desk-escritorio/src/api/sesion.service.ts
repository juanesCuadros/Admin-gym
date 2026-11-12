import type { EstadoSesion, PersonaConPin } from '../types/sesion.types';
import { invocar } from './tauri';

export const sesionService = {
  estado: () => invocar<EstadoSesion>('estado_sesion'),
  registrarActividad: () => invocar<EstadoSesion>('registrar_actividad'),
  personalConPin: () => invocar<PersonaConPin[]>('personal_con_pin'),
  iniciarConPassword: (correo: string, password: string) =>
    invocar<EstadoSesion>('iniciar_sesion_password', { correo, password }),
  iniciarConPin: (staffId: string, pin: string) => invocar<EstadoSesion>('iniciar_sesion_pin', { staffId, pin }),
  desbloquearConPin: (pin: string) => invocar<EstadoSesion>('desbloquear_sesion', { pin }),
  desbloquearConPassword: (password: string) => invocar<EstadoSesion>('desbloquear_sesion', { password }),
  bloquear: () => invocar<EstadoSesion>('bloquear_sesion'),
  cerrar: () => invocar<EstadoSesion>('cerrar_sesion'),
  definirPin: (passwordActual: string, pin: string) =>
    invocar<EstadoSesion>('definir_pin', { passwordActual, pin }),
};
