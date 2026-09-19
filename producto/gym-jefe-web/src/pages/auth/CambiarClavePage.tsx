import React from 'react';
import { Link } from 'react-router-dom';
import { Construction } from 'lucide-react';
import { EncabezadoGimnasio } from './EncabezadoGimnasio';

/**
 * Cambio obligatorio de contraseña (§C4).
 *
 * No implementada: el backend no expone un endpoint de cambio de contraseña con sesión
 * (solo `/auth/recuperar-password/*` por token) ni marca contraseñas temporales en
 * `UsuarioAuthDto` (no hay `debe_cambiar_password` ni vencimiento de 72 h). Sin eso, no hay
 * forma de saber a quién bloquear la navegación ni a dónde enviar la nueva contraseña.
 * Regla §A7: si el endpoint no existe, la vista no se implementa; se reporta.
 */
export const CambiarClavePage: React.FC = () => (
  <div className="pantalla-publica">
    <div className="tarjeta-publica" style={{ textAlign: 'center' }}>
      <EncabezadoGimnasio />
      <Construction size={36} color="var(--text-muted)" style={{ marginBottom: 12 }} />
      <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
        Cambio de contraseña no disponible
      </h2>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: 8 }}>
        Esta pantalla se habilitará cuando el servidor permita cambiar la contraseña desde la sesión. Si necesitas una
        contraseña nueva, usa la opción "¿Olvidaste tu contraseña?" en el ingreso.
      </p>
      <Link to="/" className="btn btn-outline" style={{ marginTop: 20 }}>
        Ir a inicio
      </Link>
    </div>
  </div>
);
