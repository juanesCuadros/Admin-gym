import React, { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { MensajeFijo, Cargando } from '../../components/estados/Estados';
import { STORAGE } from '../../api/client';
import { EncabezadoGimnasio } from './EncabezadoGimnasio';

function rutaDeRetorno(stateFrom: string | undefined): string {
  const guardada = sessionStorage.getItem(STORAGE.returnTo);
  const destino = stateFrom || guardada || '/';
  sessionStorage.removeItem(STORAGE.returnTo);
  return destino.startsWith('/') ? destino : '/';
}

/** Login sin acceso demo ni selector de gimnasio (§B1). Los casos de borde se completan en la Tanda 1. */
export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated } = useAuth();
  const { tenant, estadoBranding } = useTenantTheme();

  const from = (location.state as { from?: string } | null)?.from;

  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const destinoRef = useRef<string | null>(null);

  useEffect(() => {
    if (estadoBranding === 'no_disponible') {
      navigate('/bloqueado', { replace: true, state: { motivo: 'no_disponible' } });
    }
  }, [estadoBranding, navigate]);

  if (isAuthenticated) {
    return <Navigate to={destinoRef.current ?? rutaDeRetorno(from)} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando || !correo || !password) return;
    setEnviando(true);
    setErrorGeneral(null);
    destinoRef.current = rutaDeRetorno(from);
    const resultado = await login({ subdominio: tenant.subdominio, correo: correo.trim(), password });
    setEnviando(false);
    if (!resultado.ok && resultado.error.tipo !== 'suspendido') setErrorGeneral(resultado.error.message);
  };

  return (
    <div className="pantalla-publica">
      <div className="tarjeta-publica">
        {estadoBranding === 'cargando' ? (
          <Cargando filas={3} alto={40} etiqueta="Cargando gimnasio" />
        ) : (
          <EncabezadoGimnasio subtitulo="Ingresa con tu correo y contraseña" />
        )}

        {errorGeneral && (
          <MensajeFijo tono="error" style={{ marginBottom: 16 }}>
            {errorGeneral}
          </MensajeFijo>
        )}

        <form onSubmit={handleSubmit}>
          <Input
            label="Correo"
            type="email"
            placeholder="tu@correo.com"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            autoFocus
            required
          />
          <Input
            label="Contraseña"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button
            type="submit"
            variant="primary"
            isLoading={enviando}
            style={{ width: '100%', marginTop: 8 }}
            rightIcon={<ArrowRight size={16} />}
          >
            Ingresar
          </Button>
        </form>
      </div>
    </div>
  );
};
