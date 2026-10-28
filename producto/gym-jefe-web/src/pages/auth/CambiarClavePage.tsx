import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { authService } from '../../api/auth.service';
import { toApiError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { MensajeFijo } from '../../components/estados/Estados';
import { formatFechaHora } from '../../utils/formato';
import { EncabezadoGimnasio } from './EncabezadoGimnasio';
import { BotonVerPassword, MIN_PASSWORD, ReglasPassword } from './NuevaClavePage';

/**
 * Cambio de contraseña con sesión (§C4), contra `POST /auth/cambiar-password`.
 * Con contraseña temporal es obligatorio: ProtectedRoute devuelve aquí desde cualquier ruta.
 * El backend cierra las demás sesiones del usuario; la actual sigue viva.
 */
export const CambiarClavePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout, marcarPasswordCambiada, cerrarPorTemporalVencida } = useAuth();
  const { showToast } = useToast();

  const obligatorio = !!user?.debe_cambiar_password;
  const expiraEn = user?.password_temporal_expira_en ?? null;

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [ver, setVer] = useState(false);
  const [errores, setErrores] = useState<{ actual?: string; nueva?: string; confirmacion?: string }>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  // La temporal vence estando en la pantalla: se cierra la sesión y el login pide una nueva (§C4).
  useEffect(() => {
    if (!obligatorio || !expiraEn) return;
    const restante = new Date(expiraEn).getTime() - Date.now();
    if (restante <= 0) {
      cerrarPorTemporalVencida();
      return;
    }
    // setTimeout no admite más de ~24,8 días; la temporal dura 72 h.
    const t = window.setTimeout(cerrarPorTemporalVencida, Math.min(restante, 2_147_000_000));
    return () => window.clearTimeout(t);
  }, [obligatorio, expiraEn, cerrarPorTemporalVencida]);

  const validarActual = (): boolean => {
    if (!actual) {
      setErrores((e) => ({ ...e, actual: 'Escribe tu contraseña actual.' }));
      return false;
    }
    setErrores((e) => ({ ...e, actual: undefined }));
    return true;
  };

  const validarNueva = (): boolean => {
    if (nueva.length < MIN_PASSWORD) {
      setErrores((e) => ({ ...e, nueva: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` }));
      return false;
    }
    if (actual && nueva === actual) {
      setErrores((e) => ({ ...e, nueva: 'La nueva contraseña debe ser distinta de la actual.' }));
      return false;
    }
    setErrores((e) => ({ ...e, nueva: undefined }));
    return true;
  };

  const validarConfirmacion = (): boolean => {
    if (confirmacion !== nueva) {
      setErrores((e) => ({ ...e, confirmacion: 'Las contraseñas no coinciden.' }));
      return false;
    }
    setErrores((e) => ({ ...e, confirmacion: undefined }));
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviandoRef.current) return;
    const a = validarActual();
    const b = validarNueva();
    const c = validarConfirmacion();
    if (!a || !b || !c) return;

    enviandoRef.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      await authService.cambiarPassword({ password_actual: actual, password_nueva: nueva });
      marcarPasswordCambiada();
      showToast('success', 'Contraseña actualizada', 'Se cerraron tus demás sesiones abiertas.');
      navigate('/', { replace: true });
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr.tipo === 'suspendido') return; // el interceptor ya envió a /bloqueado
      if (apiErr.codigo === 'PASSWORD_ACTUAL_INCORRECTA') {
        setErrores((prev) => ({ ...prev, actual: apiErr.message }));
        return;
      }
      if (apiErr.codigo === 'PASSWORD_IGUAL_A_ACTUAL') {
        setErrores((prev) => ({ ...prev, nueva: apiErr.message }));
        return;
      }
      if (apiErr.tipo === 'validacion' && (apiErr.campos.password_nueva || apiErr.campos.password_actual)) {
        setErrores((prev) => ({
          ...prev,
          nueva: apiErr.campos.password_nueva ?? prev.nueva,
          actual: apiErr.campos.password_actual ?? prev.actual,
        }));
        return;
      }
      setErrorGeneral(apiErr.message);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  return (
    <div className="pantalla-publica">
      <div className="tarjeta-publica">
        <EncabezadoGimnasio subtitulo={obligatorio ? 'Crea tu contraseña personal' : 'Cambia tu contraseña'} />

        {obligatorio && (
          <MensajeFijo tono="info" style={{ marginBottom: 16 }}>
            Ingresaste con una contraseña temporal. Para continuar, cámbiala por una que solo tú conozcas.
            {expiraEn && <> La temporal vence el {formatFechaHora(expiraEn)}.</>}
          </MensajeFijo>
        )}

        {errorGeneral && (
          <MensajeFijo tono="error" style={{ marginBottom: 16 }}>
            {errorGeneral}
          </MensajeFijo>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <Input
            label={obligatorio ? 'Contraseña temporal' : 'Contraseña actual'}
            type={ver ? 'text' : 'password'}
            autoComplete="current-password"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            onBlur={validarActual}
            error={errores.actual}
            leftIcon={<KeyRound size={16} />}
            rightIcon={<BotonVerPassword visible={ver} onToggle={() => setVer((v) => !v)} />}
            autoFocus
          />
          <Input
            label="Nueva contraseña"
            type={ver ? 'text' : 'password'}
            autoComplete="new-password"
            value={nueva}
            onChange={(e) => setNueva(e.target.value)}
            onBlur={validarNueva}
            error={errores.nueva}
            leftIcon={<KeyRound size={16} />}
          />
          <Input
            label="Confirmar contraseña"
            type={ver ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            onBlur={validarConfirmacion}
            error={errores.confirmacion}
            leftIcon={<KeyRound size={16} />}
          />
          <ReglasPassword password={nueva} confirmacion={confirmacion} />
          <Button type="submit" variant="primary" isLoading={enviando} style={{ width: '100%' }}>
            Guardar contraseña
          </Button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 14 }}>
          {obligatorio ? (
            <Button variant="ghost" size="sm" leftIcon={<LogOut size={14} />} onClick={() => logout()} disabled={enviando}>
              Salir
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} disabled={enviando}>
              Volver
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
