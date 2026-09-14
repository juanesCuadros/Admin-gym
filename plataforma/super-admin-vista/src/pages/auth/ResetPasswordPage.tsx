import React, { useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { authService } from '@/services/authService';
import { useToast } from '@/hooks/useToast';
import { Lock, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { parseApiError } from '@/services/api/errorHandler';

export const ResetPasswordPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const tokenFromUrl = searchParams.get('token') || '';
  const [token, setToken] = useState(tokenFromUrl);
  const [nuevaPassword, setNuevaPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!token.trim()) {
      setErrorMessage('El token de restablecimiento es requerido.');
      return;
    }
    if (nuevaPassword.length < 8) {
      setErrorMessage('La nueva contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (nuevaPassword !== confirmPassword) {
      setErrorMessage('Las contraseñas no coinciden.');
      return;
    }

    setIsLoading(true);
    try {
      await authService.resetPassword({
        token: token.trim(),
        nueva_password: nuevaPassword,
      });
      success('Contraseña actualizada exitosamente. Ya puedes iniciar sesión.');
      navigate('/login');
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

        <h2
          style={{
            fontSize: 'var(--font-size-2xl)',
            fontWeight: 'var(--font-weight-bold)',
            color: 'var(--color-text-primary)',
            marginBottom: '6px',
          }}
        >
          Restablecer Contraseña
        </h2>
        <p
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-secondary)',
            marginBottom: '24px',
          }}
        >
          Ingresa el token recibido y define tu nueva contraseña segura.
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
          {!tokenFromUrl && (
            <FormField label="Token de Restablecimiento" required>
              <TextInput
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Pega aquí el token recibido"
                required
              />
            </FormField>
          )}

          <FormField label="Nueva Contraseña" required helperText="Mínimo 8 caracteres">
            <TextInput
              type="password"
              value={nuevaPassword}
              onChange={(e) => setNuevaPassword(e.target.value)}
              placeholder="••••••••••••"
              leftElement={<Lock size={16} />}
              required
            />
          </FormField>

          <FormField label="Confirmar Nueva Contraseña" required>
            <TextInput
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              leftElement={<Lock size={16} />}
              required
            />
          </FormField>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            isLoading={isLoading}
            style={{ marginTop: '12px' }}
          >
            Guardar Nueva Contraseña
          </Button>
        </form>
      </div>
    </div>
  );
};
