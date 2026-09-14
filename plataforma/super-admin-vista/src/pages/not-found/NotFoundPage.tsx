import React from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/actions/Button';
import { Home } from 'lucide-react';

export const NotFoundPage: React.FC = () => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '70vh',
        textAlign: 'center',
        padding: '32px',
      }}
    >
      <div
        style={{
          fontSize: '72px',
          fontWeight: 'var(--font-weight-bold)',
          color: 'var(--color-text-tertiary)',
          lineHeight: 1,
          marginBottom: '16px',
          fontFamily: 'var(--font-mono)',
        }}
      >
        404
      </div>

      <h1
        style={{
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 'var(--font-weight-semibold)',
          color: 'var(--color-text-primary)',
          marginBottom: '8px',
        }}
      >
        Página No Encontrada
      </h1>

      <p
        style={{
          fontSize: 'var(--font-size-md)',
          color: 'var(--color-text-secondary)',
          maxWidth: '400px',
          marginBottom: '24px',
          lineHeight: 1.5,
        }}
      >
        La ruta solicitada no existe o no se encuentra disponible en el panel de Super Administrador.
      </p>

      <Link to="/">
        <Button variant="primary" leftIcon={<Home size={16} />}>
          Volver a la Torre de Control
        </Button>
      </Link>
    </div>
  );
};
