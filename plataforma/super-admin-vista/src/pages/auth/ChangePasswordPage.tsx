import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { Button } from '@/components/actions/Button';
import { FormField } from '@/components/forms/FormField';
import { TextInput } from '@/components/forms/TextInput';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { authService } from '@/services/authService';
import { useToast } from '@/hooks/useToast';
import { parseApiError } from '@/services/api/errorHandler';

const MIN_PASSWORD = 8;

/**
 * Cambio de contraseña con sesión (SA-RF-00.2 CA3). El servidor cierra todas las demás sesiones
 * del usuario y devuelve un token nuevo para esta.
 */
export const ChangePasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const { success } = useToast();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [errores, setErrores] = useState<{ actual?: string; nueva?: string; confirmacion?: string }>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const enviandoRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviandoRef.current) return;
    const nuevos: typeof errores = {};
    if (!actual) nuevos.actual = 'Escribe tu contraseña actual.';
    if (nueva.length < MIN_PASSWORD) nuevos.nueva = `Debe tener al menos ${MIN_PASSWORD} caracteres.`;
    else if (nueva === actual) nuevos.nueva = 'Debe ser distinta de la actual.';
    if (confirmacion !== nueva) nuevos.confirmacion = 'Las contraseñas no coinciden.';
    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) return;

    enviandoRef.current = true;
    setIsLoading(true);
    setErrorGeneral(null);
    try {
      await authService.changePassword({ password_actual: actual, password_nueva: nueva });
      success('Contraseña actualizada. Se cerraron tus demás sesiones abiertas.');
      navigate('/');
    } catch (err) {
      const parsed = parseApiError(err);
      if (parsed.codigo === 'PASSWORD_ACTUAL_INCORRECTA') setErrores({ actual: parsed.message });
      else if (parsed.codigo === 'PASSWORD_IGUAL_A_ACTUAL') setErrores({ nueva: parsed.message });
      else setErrorGeneral(parsed.message);
    } finally {
      enviandoRef.current = false;
      setIsLoading(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader title="Cambiar contraseña" subtitle="Al cambiarla se cierran tus sesiones en otros navegadores." />
      <div
        style={{
          maxWidth: '440px',
          backgroundColor: 'var(--color-bg-card)',
          borderRadius: 'var(--radius-xl)',
          padding: '28px',
          border: '1px solid var(--color-border)',
        }}
      >
        {errorGeneral && (
          <div
            role="alert"
            style={{
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--color-error-light)',
              color: 'var(--color-error)',
              fontSize: 'var(--font-size-xs)',
              marginBottom: '16px',
            }}
          >
            {errorGeneral}
          </div>
        )}
        <form onSubmit={handleSubmit} noValidate>
          <FormField label="Contraseña actual" required error={errores.actual}>
            <TextInput
              type="password"
              autoComplete="current-password"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
              leftElement={<Lock size={16} />}
              autoFocus
            />
          </FormField>
          <FormField label="Nueva contraseña" required helperText={`Mínimo ${MIN_PASSWORD} caracteres`} error={errores.nueva}>
            <TextInput
              type="password"
              autoComplete="new-password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              leftElement={<Lock size={16} />}
            />
          </FormField>
          <FormField label="Confirmar nueva contraseña" required error={errores.confirmacion}>
            <TextInput
              type="password"
              autoComplete="new-password"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              leftElement={<Lock size={16} />}
            />
          </FormField>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
            <Button type="button" variant="cancel" onClick={() => navigate(-1)} disabled={isLoading}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isLoading}>
              Guardar contraseña
            </Button>
          </div>
        </form>
      </div>
    </PageContainer>
  );
};
