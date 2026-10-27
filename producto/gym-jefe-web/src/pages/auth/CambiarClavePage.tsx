import React from 'react';
import { Link } from 'react-router-dom';
import { Construction } from 'lucide-react';
import { EncabezadoGimnasio } from './EncabezadoGimnasio';
export const CambiarClavePage: React.FC = () => (
  <div className="pantalla-publica">
    <div className="tarjeta-publica" style={{ textAlign: 'center' }}>
      <EncabezadoGimnasio />
      <Construction size={36} color="var(--text-muted)" style={{ marginBottom: 12 }} />
      <h2 style={{ fontSize: '1.1rem', fontWeight: 500, color: 'var(--text-primary)' }}>
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
