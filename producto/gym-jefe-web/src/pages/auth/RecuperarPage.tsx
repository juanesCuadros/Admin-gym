import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, MailCheck, Send } from 'lucide-react';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { authService } from '../../api/auth.service';
import { toApiError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { MensajeFijo, Cargando } from '../../components/estados/Estados';
import { EncabezadoGimnasio } from './EncabezadoGimnasio';

const REGEX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Solicitar recuperación (§C2). La confirmación es idéntica exista o no el correo. */
export const RecuperarPage: React.FC = () => {
  const navigate = useNavigate();
  const { tenant, estadoBranding } = useTenantTheme();

  const [correo, setCorreo] = useState('');
  const [errorCorreo, setErrorCorreo] = useState<string | undefined>();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const enviandoRef = useRef(false);

  useEffect(() => {
    if (estadoBranding === 'no_disponible') {
      navigate('/bloqueado', { replace: true, state: { motivo: 'no_disponible' } });
    }
  }, [estadoBranding, navigate]);

  const validar = (): boolean => {
    const v = correo.trim();
    if (!v) {
      setErrorCorreo('Escribe tu correo.');
      return false;
    }
    if (!REGEX_CORREO.test(v)) {
      setErrorCorreo('El correo no tiene un formato válido.');
      return false;
    }
    setErrorCorreo(undefined);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviandoRef.current || !validar()) return;

    enviandoRef.current = true;
    setEnviando(true);
    setErrorGeneral(null);
    try {
      await authService.solicitarRecuperacion({ subdominio: tenant.subdominio, correo: correo.trim().toLowerCase() });
      setEnviado(true);
    } catch (err) {
      const e = toApiError(err);
      if (e.tipo === 'suspendido') return;
      if (e.status === 404 && e.codigo === 'GIMNASIO_NO_ENCONTRADO') {
        navigate('/bloqueado', { replace: true, state: { motivo: 'no_encontrado' } });
        return;
      }
      if (e.tipo === 'validacion' && e.campos.correo) {
        setErrorCorreo(e.campos.correo);
        return;
      }
      if (e.tipo === 'red' || e.tipo === 'servidor' || e.tipo === 'limite') {
        setErrorGeneral(e.message);
        return;
      }
      // Cualquier otro rechazo se trata como enviado: no se revela si el correo existe.
      setEnviado(true);
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  return (
    <div className="pantalla-publica">
      <div className="tarjeta-publica">
        {estadoBranding === 'cargando' ? (
          <Cargando filas={3} alto={40} etiqueta="Cargando gimnasio" />
        ) : (
          <EncabezadoGimnasio subtitulo={enviado ? undefined : 'Te enviaremos un enlace para crear una nueva contraseña'} />
        )}

        {enviado ? (
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
              <MailCheck size={26} />
            </div>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Revisa tu correo</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: 8 }}>
              Si <strong>{correo.trim()}</strong> está registrado en {tenant.nombre}, recibirás un enlace para crear una
              nueva contraseña. Solo sirve el último enlace enviado y vence en 1 hora.
            </p>
            <Link to="/login" className="btn btn-outline" style={{ marginTop: 20 }}>
              Volver a ingresar
            </Link>
          </div>
        ) : (
          <>
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
                onBlur={validar}
                error={errorCorreo}
                disabled={estadoBranding === 'cargando' || estadoBranding === 'sin_subdominio'}
                autoFocus
              />
              <Button
                type="submit"
                variant="primary"
                isLoading={enviando}
                disabled={estadoBranding === 'cargando' || estadoBranding === 'sin_subdominio'}
                style={{ width: '100%', marginTop: 8 }}
                rightIcon={<Send size={16} />}
              >
                Enviar enlace
              </Button>
            </form>
            <div style={{ textAlign: 'center', marginTop: 18, fontSize: '0.875rem' }}>
              <Link
                to="/login"
                style={{
                  color: 'var(--text-secondary)',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <ArrowLeft size={14} /> Volver a ingresar
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
