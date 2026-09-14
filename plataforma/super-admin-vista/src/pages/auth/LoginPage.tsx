import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { Dumbbell, Lock, Mail } from 'lucide-react';
import { parseApiError } from '@/services/api/errorHandler';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { success, error: toastError } = useToast();

  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!correo.trim() || !password) {
      setErrorMessage('Por favor ingresa tu correo y contraseña.');
      return;
    }

    setIsLoading(true);
    try {
      await login({ correo: correo.trim(), password });
      success('Bienvenido al panel de Super Administrador de GymOS.');
      navigate('/');
    } catch (err) {
      const parsed = parseApiError(err);
      setErrorMessage(parsed.message);
      toastError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: 'var(--color-bg-canvas)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '420px',
          backgroundColor: 'var(--color-bg-card)',
          borderRadius: 'var(--radius-xl)',
          padding: '36px 32px',
          border: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-xl)',
          animation: 'fadeInScale 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        }}
      >
        {/* Header Branding */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: 'var(--radius-lg)',
              background: 'linear-gradient(135deg, var(--color-action), #5856D6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#FFFFFF',
              margin: '0 auto 16px',
              boxShadow: '0 4px 14px rgba(0, 122, 255, 0.35)',
            }}
          >
            <Dumbbell size={26} strokeWidth={2.5} />
          </div>

          <h1
            style={{
              fontSize: 'var(--font-size-2xl)',
              fontWeight: 'var(--font-weight-bold)',
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.02em',
              marginBottom: '6px',
            }}
          >
            GymOS Super Admin
          </h1>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }}>
            Panel privado de supervisión y gestión integral
          </p>
        </div>

        {/* Error notification */}
        {errorMessage && (
          <div
            role="alert"
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-error-light)',
              border: '1px solid rgba(255, 59, 48, 0.3)',
              color: 'var(--color-error)',
              fontSize: 'var(--font-size-sm)',
              marginBottom: '20px',
              lineHeight: 1.4,
            }}
          >
            {errorMessage}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <FormField label="Correo Corporativo" required>
            <TextInput
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              placeholder="nombre@empresa.com"
              autoComplete="username"
              leftElement={<Mail size={16} />}
              required
            />
          </FormField>

          <FormField label="Contraseña" required>
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              leftElement={<Lock size={16} />}
              required
            />
          </FormField>

          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              marginTop: '-4px',
              marginBottom: '24px',
            }}
          >
            <Link
              to="/recovery"
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-action)',
                fontWeight: 'var(--font-weight-medium)',
              }}
            >
              ¿Olvidaste tu contraseña?
            </Link>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            isLoading={isLoading}
          >
            Iniciar Sesión
          </Button>
        </form>

        {/* Security Warning note (RF-00.4) */}
        <div
          style={{
            marginTop: '28px',
            paddingTop: '20px',
            borderTop: '1px solid var(--color-border-subtle)',
            fontSize: 'var(--font-size-2xs)',
            color: 'var(--color-text-tertiary)',
            textAlign: 'center',
            lineHeight: 1.45,
          }}
        >
          Protegido con control de fuerza bruta (bloqueo automático tras 5 intentos fallidos en 15 minutos).
        </div>
      </div>
    </div>
  );
};
