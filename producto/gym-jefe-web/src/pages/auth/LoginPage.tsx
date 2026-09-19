import React, { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { MensajeFijo, Cargando } from '../../components/estados/Estados';
import { STORAGE } from '../../api/client';
import { EncabezadoGimnasio } from './EncabezadoGimnasio';

/** El mismo texto para credenciales malas, correo inexistente, usuario desactivado y cuenta bloqueada (§C1). */
const MENSAJE_GENERICO = 'Correo o contraseña incorrectos.';

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function rutaDeRetorno(stateFrom: string | undefined): string {
  const guardada = sessionStorage.getItem(STORAGE.returnTo);
  const destino = stateFrom || guardada || '/';
  sessionStorage.removeItem(STORAGE.returnTo);
  return destino.startsWith('/') ? destino : '/';
}

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, consumirMotivoFinSesion } = useAuth();
  const { tenant, estadoBranding, recargarBranding } = useTenantTheme();

  const from = (location.state as { from?: string } | null)?.from;

  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [verPassword, setVerPassword] = useState(false);
  const [errores, setErrores] = useState<{ correo?: string; password?: string }>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  // Destino tras ingresar; se resuelve antes de llamar al login para no consumirlo dos veces.
  const destinoRef = useRef<string | null>(null);

  // Motivo por el que terminó la sesión anterior (expirada / inactividad), como mensaje fijo.
  const [aviso] = useState(() => {
    const m = consumirMotivoFinSesion();
    if (m === 'inactividad') return 'Tu sesión terminó por inactividad. Vuelve a iniciar sesión.';
    if (m === 'expirada') return 'Tu sesión terminó. Vuelve a iniciar sesión.';
    return null;
  });

  // Gimnasio bloqueado o inexistente: no se valida contraseña, va a /bloqueado (§C1).
  useEffect(() => {
    if (estadoBranding === 'no_disponible') {
      navigate('/bloqueado', { replace: true, state: { motivo: 'no_disponible' } });
    }
  }, [estadoBranding, navigate]);

  if (isAuthenticated) {
    return <Navigate to={destinoRef.current ?? rutaDeRetorno(from)} replace />;
  }

  const validarCorreo = (): boolean => {
    const v = correo.trim();
    if (!v) {
      setErrores((e) => ({ ...e, correo: 'Escribe tu correo.' }));
      return false;
    }
    if (!REGEX_CORREO.test(v)) {
      setErrores((e) => ({ ...e, correo: 'El correo no tiene un formato válido.' }));
      return false;
    }
    setErrores((e) => ({ ...e, correo: undefined }));
    return true;
  };

  const validarPassword = (): boolean => {
    if (!password) {
      setErrores((e) => ({ ...e, password: 'Escribe tu contraseña.' }));
      return false;
    }
    setErrores((e) => ({ ...e, password: undefined }));
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Doble clic en Ingresar → un solo intento.
    if (enviandoRef.current) return;

    const correoOk = validarCorreo();
    const passOk = validarPassword();
    if (!correoOk || !passOk) return;

    enviandoRef.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    destinoRef.current = rutaDeRetorno(from);

    const resultado = await login({
      subdominio: tenant.subdominio,
      correo: correo.trim().toLowerCase(),
      password,
    });

    enviandoRef.current = false;
    setEnviando(false);

    if (resultado.ok) {
      // Orden de §C1:
      // 1. Contraseña temporal → /cambiar-clave. Pendiente: el backend no marca contraseñas temporales.
      // 2. Recepcionista sin turno → /caja con el modal. Lo aplica el guard del layout en cualquier ruta.
      // 3. Ruta guardada o Inicio: lo hace el <Navigate> de arriba al quedar autenticado.
      return;
    }

    const err = resultado.error;

    if (err.tipo === 'suspendido') return; // el interceptor ya envió a /bloqueado

    if (err.status === 404 && err.codigo === 'GIMNASIO_NO_ENCONTRADO') {
      navigate('/bloqueado', { replace: true, state: { motivo: 'no_encontrado' } });
      return;
    }

    if (err.tipo === 'validacion' && Object.keys(err.campos).length > 0) {
      setErrores({ correo: err.campos.correo, password: err.campos.password });
      if (!err.campos.correo && !err.campos.password) setErrorGeneral(err.message);
      return;
    }

    if (err.tipo === 'red' || err.tipo === 'servidor') {
      setErrorGeneral(err.message);
      return;
    }

    // 401, 403 (usuario desactivado), 429 (bloqueo por intentos) y usuario de otro gimnasio:
    // siempre el mismo mensaje. No se revela nada.
    setErrorGeneral(MENSAJE_GENERICO);
  };

  const sinGimnasio = estadoBranding === 'sin_subdominio';
  const formularioDeshabilitado = sinGimnasio || estadoBranding === 'cargando';

  return (
    <div className="pantalla-publica">
      <div className="tarjeta-publica">
        {estadoBranding === 'cargando' ? (
          <Cargando filas={3} alto={40} etiqueta="Cargando gimnasio" />
        ) : (
          <EncabezadoGimnasio subtitulo="Ingresa con tu correo y contraseña" />
        )}

        {sinGimnasio && (
          <MensajeFijo tono="error" style={{ marginBottom: 16 }}>
            No se pudo identificar el gimnasio. Entra por la dirección de tu gimnasio.
          </MensajeFijo>
        )}

        {estadoBranding === 'error_carga' && (
          <MensajeFijo
            tono="error"
            style={{ marginBottom: 16 }}
            accion={
              <Button variant="outline" size="sm" leftIcon={<RefreshCw size={14} />} onClick={() => recargarBranding()}>
                Reintentar
              </Button>
            }
          >
            No se pudo cargar la información del gimnasio. Puedes intentar ingresar de todos modos.
          </MensajeFijo>
        )}

        {aviso && (
          <MensajeFijo tono="info" style={{ marginBottom: 16 }}>
            {aviso}
          </MensajeFijo>
        )}

        {errorGeneral && (
          <MensajeFijo tono="error" style={{ marginBottom: 16 }}>
            {errorGeneral}
          </MensajeFijo>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <Input
            label="Correo"
            type="email"
            autoComplete="username"
            placeholder="tu@correo.com"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            onBlur={validarCorreo}
            error={errores.correo}
            disabled={formularioDeshabilitado}
            autoFocus
          />

          <Input
            label="Contraseña"
            type={verPassword ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={validarPassword}
            error={errores.password}
            disabled={formularioDeshabilitado}
            rightIcon={
              <button
                type="button"
                onClick={() => setVerPassword((v) => !v)}
                aria-label={verPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                tabIndex={-1}
                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', display: 'flex', padding: 0 }}
              >
                {verPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            }
          />

          <Button
            type="submit"
            variant="primary"
            isLoading={enviando}
            disabled={formularioDeshabilitado}
            style={{ width: '100%', marginTop: 8 }}
            rightIcon={<ArrowRight size={16} />}
          >
            Ingresar
          </Button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 18, fontSize: '0.875rem' }}>
          <Link to="/recuperar" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
            ¿Olvidaste tu contraseña?
          </Link>
        </div>
      </div>
    </div>
  );
};
