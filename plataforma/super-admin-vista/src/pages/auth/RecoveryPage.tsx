import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { authService } from '@/services/authService';
import { useToast } from '@/hooks/useToast';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { parseApiError } from '@/services/api/errorHandler';

export const RecoveryPage: React.FC = () => {
  const { success, error: toastError } = useToast();
  const [correo, setCorreo] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correo.trim()) {
      setErrorMessage('Por favor ingresa tu correo electrónico.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      await authService.requestRecovery({ correo: correo.trim() });
      setSubmitted(true);
      success('Si la cuenta existe en el sistema, recibirás las instrucciones en tu bandeja de entrada.');
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
        <Link
          to="/login"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-secondary)',
            marginBottom: '24px',
          }}
        >
          <ArrowLeft size={14} />
          Volver a Iniciar Sesión
        </Link>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: 'var(--radius-full)',
                backgroundColor: 'var(--color-success-light)',
                color: 'var(--color-success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
              }}
            >
              <CheckCircle2 size={24} />
            </div>
            <h2 style={{ fontSize: 'var(--font-size-xl)', marginBottom: '8px' }}>
              Enlace de Recuperación Enviado
            </h2>
            <p
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-secondary)',
                lineHeight: 1.5,
                marginBottom: '24px',
              }}
            >
              Si el correo <strong>{correo}</strong> corresponde a un usuario activo de GymOS, hemos enviado un enlace para restablecer tu contraseña.
            </p>
            <Link to="/login">
              <Button variant="secondary" fullWidth>
                Regresar al Login
              </Button>
            </Link>
          </div>
        ) : (
          <>
            <h2
              style={{
                fontSize: 'var(--font-size-2xl)',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--color-text-primary)',
                marginBottom: '6px',
              }}
            >
              Recuperar Contraseña
            </h2>
            <p
              style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--color-text-secondary)',
                marginBottom: '24px',
                lineHeight: 1.45,
              }}
            >
              Ingresa tu correo corporativo registrado para recibir el enlace seguro de restablecimiento.
            </p>

            {errorMessage && (
              <div
                style={{
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-error-light)',
                  color: 'var(--color-error)',
                  fontSize: 'var(--font-size-xs)',
                  marginBottom: '16px',
                }}
              >
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <FormField label="Correo Corporativo" required>
                <TextInput
                  type="email"
                  value={correo}
                  onChange={(e) => setCorreo(e.target.value)}
                  placeholder="nombre@empresa.com"
                  leftElement={<Mail size={16} />}
                  required
                />
              </FormField>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
                style={{ marginTop: '8px' }}
              >
                Enviar Enlace de Recuperación
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};
