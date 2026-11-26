import React, { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Cargando, MensajeFijo } from '../../components/estados/Estados';
import { EncabezadoGimnasio } from '../auth/EncabezadoGimnasio';
import { leerSesionPortal, portalService } from '../../api/portal.service';
import { toApiError } from '../../api/client';

type PasoAcceso = 'correo' | 'pin' | 'crear_password' | 'password';

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const PortalLoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { tenant, estadoBranding, recargarBranding } = useTenantTheme();
  const { showToast } = useToast();

  const sesionActiva = leerSesionPortal();

  const [paso, setPaso] = useState<PasoAcceso>('correo');
  const [correo, setCorreo] = useState('');
  const [pin, setPin] = useState('');
  const [setupToken, setSetupToken] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [verPass, setVerPass] = useState(false);
  const [verPassConfirm, setVerPassConfirm] = useState(false);

  const [mensajeInfo, setMensajeInfo] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [errorCampo, setErrorCampo] = useState<string | undefined>(undefined);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (estadoBranding === 'no_disponible') {
      navigate('/bloqueado', { replace: true, state: { motivo: 'no_disponible' } });
    }
  }, [estadoBranding, navigate]);

  if (sesionActiva) {
    return <Navigate to="/portal" replace />;
  }

  const sinGimnasio = estadoBranding === 'sin_subdominio' || !tenant.subdominio;
  const formularioDeshabilitado = sinGimnasio || estadoBranding === 'cargando';

  // Reglas de seguridad de contraseña en tiempo real
  const reglasPassword = {
    longitud: password.length >= 8,
    mayuscula: /[A-ZÁÉÍÓÚÑ]/.test(password),
    minuscula: /[a-záéíóúñ]/.test(password),
    numero: /\d/.test(password),
    especial: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?~`]/.test(password),
    coincide: password.length > 0 && password === passwordConfirm,
  };
  const passwordValida =
    reglasPassword.longitud &&
    reglasPassword.mayuscula &&
    reglasPassword.minuscula &&
    reglasPassword.numero &&
    reglasPassword.especial &&
    reglasPassword.coincide;

  const handlePasoCorreo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formularioDeshabilitado) return;
    const limpio = correo.trim().toLowerCase();
    if (!limpio) {
      setErrorCampo('Ingresa tu correo electrónico.');
      return;
    }
    if (!REGEX_CORREO.test(limpio)) {
      setErrorCampo('Ingresa un correo electrónico válido (ej. tu@correo.com).');
      return;
    }

    setErrorCampo(undefined);
    setErrorGeneral(null);
    setCargando(true);
    try {
      const res = await portalService.iniciarAcceso(limpio, tenant.subdominio, false);
      setCorreo(res.correo);
      setMensajeInfo(res.mensaje);
      if (res.paso_siguiente === 'password') {
        setPaso('password');
      } else {
        setPin('');
        setPaso('pin');
      }
    } catch (err) {
      const apiErr = toApiError(err);
      if (apiErr.status === 404 && apiErr.codigo === 'GIMNASIO_NO_ENCONTRADO') {
        navigate('/bloqueado', { replace: true, state: { motivo: 'no_encontrado' } });
        return;
      }
      setErrorGeneral(apiErr.message);
    } finally {
      setCargando(false);
    }
  };

  const handleSolicitarNuevoPin = async () => {
    if (formularioDeshabilitado) return;
    setErrorGeneral(null);
    setErrorCampo(undefined);
    setCargando(true);
    try {
      const res = await portalService.iniciarAcceso(correo, tenant.subdominio, true);
      setPin('');
      setMensajeInfo(res.mensaje);
      setPaso('pin');
      showToast('info', 'Código PIN enviado nuevamente a tu correo');
    } catch (err) {
      setErrorGeneral(toApiError(err).message);
    } finally {
      setCargando(false);
    }
  };

  const handleValidarPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formularioDeshabilitado) return;
    const pinLimpio = pin.replace(/\D/g, '');
    if (pinLimpio.length !== 6) {
      setErrorCampo('Ingresa los 6 dígitos del código PIN.');
      return;
    }

    setErrorCampo(undefined);
    setErrorGeneral(null);
    setCargando(true);
    try {
      const res = await portalService.validarPin(correo, pinLimpio, tenant.subdominio);
      setSetupToken(res.setup_token);
      setPassword('');
      setPasswordConfirm('');
      setMensajeInfo(res.mensaje);
      setPaso('crear_password');
    } catch (err) {
      setErrorGeneral(toApiError(err).message);
    } finally {
      setCargando(false);
    }
  };

  const handleCrearPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordValida) {
      setErrorGeneral('Por favor cumple todos los requisitos de seguridad de la contraseña.');
      return;
    }

    setErrorGeneral(null);
    setCargando(true);
    try {
      const res = await portalService.establecerPassword(setupToken, password, passwordConfirm);
      showToast('success', `¡Bienvenido(a), ${res.deportista.nombre}!`);
      navigate('/portal', { replace: true });
    } catch (err) {
      setErrorGeneral(toApiError(err).message);
    } finally {
      setCargando(false);
    }
  };

  const handleLoginPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formularioDeshabilitado) return;
    if (!password) {
      setErrorCampo('Ingresa tu contraseña.');
      return;
    }

    setErrorCampo(undefined);
    setErrorGeneral(null);
    setCargando(true);
    try {
      const res = await portalService.loginPassword(correo, password, tenant.subdominio);
      showToast('success', `¡Hola de nuevo, ${res.deportista.nombre}!`);
      navigate('/portal', { replace: true });
    } catch (err) {
      setErrorGeneral(toApiError(err).message);
    } finally {
      setCargando(false);
    }
  };

  const volverAlCorreo = () => {
    setPaso('correo');
    setPin('');
    setPassword('');
    setPasswordConfirm('');
    setErrorGeneral(null);
    setErrorCampo(undefined);
    setMensajeInfo(null);
  };

  return (
    <div className="pantalla-publica">
      <div className="tarjeta-publica" style={{ maxWidth: 440 }}>
        {estadoBranding === 'cargando' ? (
          <Cargando filas={3} alto={40} etiqueta="Cargando gimnasio" />
        ) : (
          <EncabezadoGimnasio
            subtitulo={
              paso === 'correo'
                ? 'Portal del Deportista · Consulta tu progreso, pagos y asistencias'
                : paso === 'pin'
                ? 'Verificación de seguridad por código PIN'
                : paso === 'crear_password'
                ? 'Configura tu contraseña segura'
                : 'Ingresa tu contraseña de deportista'
            }
          />
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

        {mensajeInfo && (
          <MensajeFijo tono="info" style={{ marginBottom: 16 }}>
            {mensajeInfo}
          </MensajeFijo>
        )}

        {errorGeneral && (
          <MensajeFijo tono="error" style={{ marginBottom: 16 }}>
            {errorGeneral}
          </MensajeFijo>
        )}

        {/* PASO 1: SOLO CORREO */}
        {paso === 'correo' && (
          <form onSubmit={handlePasoCorreo} noValidate>
            <Input
              label="Tu correo electrónico"
              type="email"
              autoComplete="email"
              placeholder="deportista@correo.com"
              leftIcon={<Mail size={16} />}
              value={correo}
              onChange={(e) => {
                setCorreo(e.target.value);
                if (errorCampo) setErrorCampo(undefined);
              }}
              error={errorCampo}
              disabled={formularioDeshabilitado}
              hint="Si es la primera vez que ingresas, enviaremos un código PIN de 6 dígitos a tu correo."
              autoFocus
            />

            <Button
              type="submit"
              variant="primary"
              isLoading={cargando}
              disabled={formularioDeshabilitado}
              style={{ width: '100%', marginTop: 12 }}
              rightIcon={<ArrowRight size={16} />}
            >
              Continuar
            </Button>
          </form>
        )}

        {/* PASO 2: VALIDAR PIN DE 6 DÍGITOS */}
        {paso === 'pin' && (
          <form onSubmit={handleValidarPin} noValidate>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                background: 'var(--bg-subtle, #f8fafc)',
                borderRadius: 8,
                border: '1px solid var(--border-color)',
                marginBottom: 14,
                fontSize: '0.85rem',
              }}
            >
              <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                PIN enviado a: <strong style={{ color: 'var(--text-primary)' }}>{correo}</strong>
              </span>
              <button
                type="button"
                onClick={volverAlCorreo}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                  marginLeft: 8,
                  whiteSpace: 'nowrap',
                }}
              >
                Cambiar correo
              </button>
            </div>

            <Input
              label="Código PIN de 6 dígitos"
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="000000"
              leftIcon={<KeyRound size={16} />}
              value={pin}
              onChange={(e) => {
                const soloDigitos = e.target.value.replace(/\D/g, '').slice(0, 6);
                setPin(soloDigitos);
                if (errorCampo) setErrorCampo(undefined);
              }}
              error={errorCampo}
              hint="Revisa tu bandeja de entrada o carpeta de spam. El PIN vence en 15 minutos."
              autoFocus
            />

            <Button
              type="submit"
              variant="primary"
              isLoading={cargando}
              disabled={pin.length !== 6}
              style={{ width: '100%', marginTop: 10 }}
              rightIcon={<ShieldCheck size={16} />}
            >
              Validar PIN
            </Button>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
              <Button type="button" variant="ghost" size="sm" leftIcon={<ArrowLeft size={14} />} onClick={volverAlCorreo}>
                Volver
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                leftIcon={<RefreshCw size={14} />}
                onClick={handleSolicitarNuevoPin}
                disabled={cargando}
              >
                Reenviar PIN
              </Button>
            </div>
          </form>
        )}

        {/* PASO 3: ESTABLECER Y VALIDAR CONTRASEÑA SEGURA */}
        {paso === 'crear_password' && (
          <form onSubmit={handleCrearPassword} noValidate>
            <Input
              label="Crea tu contraseña"
              type={verPass ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Mínimo 8 caracteres seguros"
              leftIcon={<Lock size={16} />}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setVerPass((v) => !v)}
                  tabIndex={-1}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 0 }}
                >
                  {verPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
              autoFocus
            />

            <Input
              label="Confirma tu contraseña"
              type={verPassConfirm ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Repite tu contraseña"
              leftIcon={<Lock size={16} />}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setVerPassConfirm((v) => !v)}
                  tabIndex={-1}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 0 }}
                >
                  {verPassConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />

            {/* Indicador visual de requisitos de seguridad */}
            <div
              style={{
                background: 'var(--bg-subtle, #f8fafc)',
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 14,
                fontSize: '0.8rem',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
                Requisitos de seguridad de la contraseña:
              </div>
              {[
                { ok: reglasPassword.longitud, texto: 'Mínimo 8 caracteres' },
                { ok: reglasPassword.mayuscula, texto: 'Al menos una letra mayúscula (A-Z)' },
                { ok: reglasPassword.minuscula, texto: 'Al menos una letra minúscula (a-z)' },
                { ok: reglasPassword.numero, texto: 'Al menos un número (0-9)' },
                { ok: reglasPassword.especial, texto: 'Al menos un carácter especial (@, #, $, !, %, *)' },
                { ok: reglasPassword.coincide, texto: 'Ambas contraseñas coinciden exactamente' },
              ].map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: item.ok ? 'var(--success, #16a34a)' : 'var(--text-muted)',
                    marginBottom: 3,
                  }}
                >
                  {item.ok ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                  <span>{item.texto}</span>
                </div>
              ))}
            </div>

            <Button
              type="submit"
              variant="primary"
              isLoading={cargando}
              disabled={!passwordValida}
              style={{ width: '100%' }}
              rightIcon={<ArrowRight size={16} />}
            >
              Guardar contraseña e ingresar
            </Button>
          </form>
        )}

        {/* PASO 2B: LOGIN CON CONTRASEÑA (USUARIOS YA ACTIVADOS) */}
        {paso === 'password' && (
          <form onSubmit={handleLoginPassword} noValidate>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                background: 'var(--bg-subtle, #f8fafc)',
                borderRadius: 8,
                border: '1px solid var(--border-color)',
                marginBottom: 14,
                fontSize: '0.85rem',
              }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>
                Cuenta: <strong style={{ color: 'var(--text-primary)' }}>{correo}</strong>
              </span>
              <button
                type="button"
                onClick={volverAlCorreo}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.8rem',
                }}
              >
                Cambiar
              </button>
            </div>

            <Input
              label="Contraseña"
              type={verPass ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              leftIcon={<Lock size={16} />}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errorCampo) setErrorCampo(undefined);
              }}
              error={errorCampo}
              rightIcon={
                <button
                  type="button"
                  onClick={() => setVerPass((v) => !v)}
                  tabIndex={-1}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 0 }}
                >
                  {verPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
              autoFocus
            />

            <Button
              type="submit"
              variant="primary"
              isLoading={cargando}
              style={{ width: '100%', marginTop: 8 }}
              rightIcon={<ArrowRight size={16} />}
            >
              Ingresar a mi portal
            </Button>

            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button
                type="button"
                onClick={handleSolicitarNuevoPin}
                disabled={cargando}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary)',
                  fontWeight: 500,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                ¿Olvidaste tu contraseña? Recibir código PIN en mi correo
              </button>
            </div>
          </form>
        )}

        <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '20px 0 14px' }} />

        <div style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
          ¿Eres administrador o personal del gimnasio?{' '}
          <Link to="/login" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>
            Acceso administrativo
          </Link>
        </div>
      </div>
    </div>
  );
};
