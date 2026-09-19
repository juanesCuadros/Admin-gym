import React from 'react';
import { Dumbbell } from 'lucide-react';
import { useTenantTheme } from '../../contexts/TenantThemeContext';

/** Logo y nombre del gimnasio desde el branding público del subdominio. Compartido por las vistas de auth. */
export const EncabezadoGimnasio: React.FC<{ subtitulo?: string }> = ({ subtitulo }) => {
  const { tenant } = useTenantTheme();
  return (
    <div style={{ textAlign: 'center', marginBottom: 24 }}>
      {tenant.logo_url ? (
        <img
          src={tenant.logo_url}
          alt=""
          style={{ width: 56, height: 56, borderRadius: 'var(--radius-md)', objectFit: 'cover', marginBottom: 14 }}
        />
      ) : (
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 'var(--radius-md)',
            background: 'var(--primary)',
            color: '#ffffff',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 14,
          }}
        >
          <Dumbbell size={28} />
        </div>
      )}
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        {tenant.nombre}
      </h1>
      {subtitulo && (
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 6 }}>{subtitulo}</p>
      )}
    </div>
  );
};
