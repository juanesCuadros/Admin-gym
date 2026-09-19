import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Circle, Eye, EyeOff, KeyRound, LinkIcon } from 'lucide-react';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { authService } from '../../api/auth.service';
import { limpiarSesionLocal, toApiError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { MensajeFijo, Cargando } from '../../components/estados/Estados';
import { EncabezadoGimnasio } from './EncabezadoGimnasio';

/** Regla que aplica el backend (`ConfirmarRecuperacionRequest.nueva_password`, min_length=8). */
export const MIN_PASSWORD = 8;

export const ReglasPassword: React.FC<{ password: string; confirmacion: string }> = ({ password, confirmacion }) => {
  const reglas = [
    { ok: password.length >= MIN_PASSWORD, texto: `Mínimo ${MIN_PASSWORD} caracteres` },
    { ok: password.length > 0 && password === confirmacion, texto: 'Las dos contraseñas coinciden' },
  ];
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {reglas.map((r) => (
        <li
          key={r.texto}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.85rem',
            color: r.ok ? 'var(--success)' : 'var(--text-secondary)',
          }}
        >
          {r.ok ? <Check size={14} /> : <Circle size={14} />}
          {r.texto}
        </li>
      ))}
    </ul>
  );
};

export const BotonVerPassword: React.FC<{ visible: boolean; onToggle: () => void }> = ({ visible, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-label={visible ? 'Ocultar contraseña' : 'Ver contraseña'}
    tabIndex={-1}
    style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', padding: 0 }}
  >
    {visible ? <EyeOff size={16} /> : <Eye size={16} />}
  </button>
);

/**
 * Definir nueva contraseña (§C3).
 * Pendiente de backend: no existe endpoint para validar el token al cargar; el rechazo llega al enviar.
 */
export const NuevaClavePage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { estadoBranding } = useTenantTheme();

  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [ver, setVer] = useState(false);
  const [errores, setErrores] = useState<{ password?: string; confirmacion?: string }>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [tokenInvalido, setTokenInvalido] = useState(!token || token.length < 10);
  const [exito, setExito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  useEffect(() => {
    if (estadoBranding === 'no_disponible') {
      navigate('/bloqueado', { replace: true, state: { motivo: 'no_disponible' } });
    }
  }, [estadoBranding, navigate]);

  const validarPassword = (): boolean => {
    if (password.length < MIN_PASSWORD) {
      setErrores((e) => ({ ...e, password: `La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.` }));
      return false;
    }
    setErrores((e) => ({ ...e, password: undefined }));
    return true;
  };

  const validarConfirmacion = (): boolean => {
    if (confirmacion !== password) {
      setErrores((e) => ({ ...e, confirmacion: 'Las contraseñas no coinciden.' }));
      return false;
    }
    setErrores((e) => ({ ...e, confirmacion: undefined }));
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviandoRef.current) return;
    const a = validarPassword();
    const b = validarConfirmacion();
    if (!a || !b) return;

    enviandoRef.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      await authService.confirmarRecuperacion({ token, nueva_password: password });
      // El backend cierra todas las sesiones del usuario; se limpia también la de este navegador.
      limpiarSesionLocal();
      setExito(true);
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr.tipo === 'suspendido') return;
      if (apiErr.codigo === 'TOKEN_INVALIDO_O_EXPIRADO' || apiErr.tipo === 'no_encontrado') {
        setTokenInvalido(true);
        return;
      }
      if (apiErr.tipo === 'validacion' && apiErr.campos.nueva_password) {
        setErrores((prev) => ({ ...prev, password: apiErr.campos.nueva_password }));
        return;
      }
      setErrorGeneral(apiErr.message);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  let contenido: React.ReactNode;

  if (tokenInvalido) {
    contenido = (
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 'var(--radius-md)',
            background: 'var(--danger-light)',
            color: 'var(--danger)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 14,
          }}
        >
          <LinkIcon size={26} />
        </div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Este enlace ya no sirve</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: 8 }}>
          El enlace ya fue usado, venció o se pidió otro más reciente.
        </p>
        <Link to="/recuperar" className="btn btn-primary" style={{ marginTop: 20 }}>
          Pedir un enlace nuevo
        </Link>
      </div>
    );
  } else if (exito) {
    contenido = (
      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 'var(--radius-md)',
            background: 'var(--success-light)',
            color: 'var(--success)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 14,
          }}
        >
          <Check size={26} />
        </div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Contraseña actualizada</h2>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: 8 }}>
          Se cerraron todas tus sesiones. Ingresa con tu nueva contraseña.
        </p>
        <Link to="/login" className="btn btn-primary" style={{ marginTop: 20 }}>
          Ir a ingresar
        </Link>
      </div>
    );
  } else {
    contenido = (
      <>
        {errorGeneral && (
          <MensajeFijo tono="error" style={{ marginBottom: 16 }}>
            {errorGeneral}
          </MensajeFijo>
        )}
        <form onSubmit={handleSubmit} noValidate>
          <Input
            label="Nueva contraseña"
            type={ver ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={validarPassword}
            error={errores.password}
            leftIcon={<KeyRound size={16} />}
            rightIcon={<BotonVerPassword visible={ver} onToggle={() => setVer((v) => !v)} />}
            autoFocus
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
          <ReglasPassword password={password} confirmacion={confirmacion} />
          <Button type="submit" variant="primary" isLoading={enviando} style={{ width: '100%' }}>
            Guardar contraseña
          </Button>
        </form>
      </>
    );
  }

  return (
    <div className="pantalla-publica">
      <div className="tarjeta-publica">
        {estadoBranding === 'cargando' ? (
          <Cargando filas={3} alto={40} etiqueta="Cargando gimnasio" />
        ) : (
          <EncabezadoGimnasio subtitulo={!tokenInvalido && !exito ? 'Crea tu nueva contraseña' : undefined} />
        )}
        {contenido}
      </div>
    </div>
  );
};
