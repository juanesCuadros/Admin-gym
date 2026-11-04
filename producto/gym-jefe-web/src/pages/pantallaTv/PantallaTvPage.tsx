import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Maximize2, Dumbbell, AlertCircle, Wifi, WifiOff } from 'lucide-react';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import {
  pantallaTvService,
  PantallaTvWsStatus,
  PantallaTvWsEvent,
  DisplayDataResponse,
  PantallaTvWebSocketClient,
} from '../../api/pantallaTv.service';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { urlDeImagen } from '../../api/client';
import { ZONA_HORARIA } from '../../utils/formato';
import './pantalla.css';

export const PantallaTvPage: React.FC = () => {
  const navigate = useNavigate();
  const routeParams = useParams<{ subdominio?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { tenant } = useTenantTheme();

  // 1. Resolve gym subdomain strictly without hardcoded fallback
  const activeSubdomain =
    routeParams.subdominio ||
    searchParams.get('subdominio') ||
    localStorage.getItem('gymos_tv_subdominio') ||
    localStorage.getItem('gymos_tenant_subdomain') ||
    '';

  // 2. Resolve device token
  const initialToken =
    searchParams.get('device_token') ||
    searchParams.get('token') ||
    localStorage.getItem(`gymos_tv_device_token_${activeSubdomain}`) ||
    localStorage.getItem('gymos_tv_device_token') ||
    '';

  const [deviceToken, setDeviceToken] = useState<string>(initialToken);
  const [showTokenModal, setShowTokenModal] = useState<boolean>(!initialToken);
  const [inputToken, setInputToken] = useState<string>(initialToken);

  // Connection and data state
  const [wsStatus, setWsStatus] = useState<PantallaTvWsStatus>('desconectado');
  const [reconnectDetail, setReconnectDetail] = useState<{ attempt: number; delayMs: number } | null>(null);

  const [currentTime, setCurrentTime] = useState(new Date());
  const [displayData, setDisplayData] = useState<DisplayDataResponse | null>(null);
  const [saludoActivo, setSaludoActivo] = useState<{
    nombre: string;
    mensaje: string;
    /** Reinicia la animación si entra otra persona mientras se saluda a la anterior. */
    clave: number;
  } | null>(null);
  // Los controles estorban en un televisor: aparecen solo al mover el mouse.
  const [controlesVisibles, setControlesVisibles] = useState(true);

  const [avisoIndex, setAvisoIndex] = useState(0);
  // GW-RF-07 CA3: al (re)conectar o cambiar la configuración se recarga el estado actual por REST.
  const [recargas, setRecargas] = useState(0);
  const wsClientRef = useRef<PantallaTvWebSocketClient | null>(null);
  const saludoTimeoutRef = useRef<any>(null);

  // Digital clock tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let temporizador = window.setTimeout(() => setControlesVisibles(false), 4000);
    const alMover = () => {
      setControlesVisibles(true);
      window.clearTimeout(temporizador);
      temporizador = window.setTimeout(() => setControlesVisibles(false), 3000);
    };
    window.addEventListener('mousemove', alMover);
    return () => {
      window.clearTimeout(temporizador);
      window.removeEventListener('mousemove', alMover);
    };
  }, []);

  // Fetch initial consolidated display data (RF-07)
  useEffect(() => {
    let isMounted = true;
    async function loadDisplayData() {
      try {
        const data = await pantallaTvService.getDisplayData(activeSubdomain);
        if (isMounted) {
          setDisplayData(data);
        }
      } catch (err) {
        console.warn('[Pantalla TV] No se pudo cargar display inicial REST:', err);
      }
    }
    loadDisplayData();
    return () => {
      isMounted = false;
    };
  }, [activeSubdomain, recargas]);

  // Connect WebSocket with device_token and handle auto-reconnect (RNF-06)
  useEffect(() => {
    if (!activeSubdomain || !deviceToken) {
      setWsStatus('desconectado');
      return;
    }

    const client = pantallaTvService.connectWebSocket({
      subdominio: activeSubdomain,
      deviceToken,
      onStatusChange: (status, detail) => {
        setWsStatus(status);
        if (detail) {
          setReconnectDetail(detail);
        } else if (status === 'conectado') {
          setReconnectDetail(null);
        }
      },
      onMessage: (event: PantallaTvWsEvent) => {
        if (event.tipo === 'CHECKIN_EVENTO') {
          if (saludoTimeoutRef.current) {
            clearTimeout(saludoTimeoutRef.current);
          }

          setSaludoActivo({
            nombre: event.deportista?.nombre || 'Deportista',
            mensaje: event.mensaje || '¡Bienvenido a entrenar!',
            clave: Date.now(),
          });

          const duracionMs = (displayData?.tiempo_saludo_segundos || 8) * 1000;
          saludoTimeoutRef.current = setTimeout(() => {
            setSaludoActivo(null);
          }, duracionMs);
        } else if (event.tipo === 'CONFIG_ACTUALIZADA' || event.tipo === 'CONECTADO') {
          setRecargas((n) => n + 1);
        }
      },
    });

    wsClientRef.current = client;

    return () => {
      if (saludoTimeoutRef.current) {
        clearTimeout(saludoTimeoutRef.current);
      }
      client.disconnect();
      wsClientRef.current = null;
    };
  }, [activeSubdomain, deviceToken, displayData?.tiempo_saludo_segundos]);

  // Rotate notices
  // Solo los avisos que devuelve la API; sin avisos inventados (§A7).
  const avisos = displayData?.avisos ?? [];

  useEffect(() => {
    if (avisos.length <= 1) return;
    const interval = setInterval(() => {
      setAvisoIndex((prev) => (prev + 1) % avisos.length);
    }, 8000);
    return () => clearInterval(interval);
  }, [avisos.length]);

  const handleSaveToken = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputToken.trim()) return;
    const clean = inputToken.trim();
    setDeviceToken(clean);
    localStorage.setItem(`gymos_tv_device_token_${activeSubdomain}`, clean);
    localStorage.setItem('gymos_tv_device_token', clean);
    setShowTokenModal(false);

    // Update query params if appropriate
    setSearchParams({ device_token: clean });
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // State: Subdomain not provided or pending configuration
  if (!activeSubdomain) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: '#070a11',
          color: '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          zIndex: 9999,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: '100%',
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 'var(--radius-lg)',
            padding: 36,
            textAlign: 'center',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              color: '#f59e0b',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 16,
            }}
          >
            <AlertCircle size={30} />
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 8, color: '#ffffff' }}>
            Pantalla TV sin Sede Configurada
          </h2>
          <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '0.875rem', marginBottom: 24, lineHeight: 1.5 }}>
            No se pudo resolver el subdominio del gimnasio. Para vincular este televisor con su recepción en vivo, ingresa el subdominio de tu sede o accede mediante <code>/tv/:subdominio</code>:
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const input = (form.elements.namedItem('sub') as HTMLInputElement).value.trim();
              if (input) {
                localStorage.setItem('gymos_tv_subdominio', input);
                navigate(`/tv/${input}`);
              }
            }}
            style={{ display: 'flex', gap: 10 }}
          >
            <input
              name="sub"
              placeholder="ej. iron-fit"
              autoFocus
              required
              style={{
                flex: 1,
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                outline: 'none',
                fontSize: '0.9rem',
              }}
            />
            <Button type="submit" variant="primary">
              Conectar
            </Button>
          </form>
          <div style={{ marginTop: 24 }}>
            <Button variant="ghost" size="sm" onClick={() => navigate('/inicio')} leftIcon={<ArrowLeft size={14} />}>
              Volver al sistema
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const nombreGimnasio = displayData?.nombre_gimnasio || tenant.nombre;
  const logo = urlDeImagen(displayData?.logo_url || tenant.logo_url);
  const clases = displayData?.clases_del_dia ?? [];
  const hora = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA_HORARIA, hour: 'numeric', minute: '2-digit', hour12: true }).format(currentTime);
  const fecha = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA_HORARIA, weekday: 'long', day: 'numeric', month: 'long' }).format(currentTime);
  const conectado = wsStatus === 'conectado';
  // La ventana abierta desde el panel se cierra sola; en un televisor aparte se vuelve al sistema.
  const abiertaDesdePanel = !!window.opener;
  const estadoConexion = conectado ? (
    <>
      <Wifi size={15} /> En vivo
    </>
  ) : wsStatus === 'reconectando' ? (
    <>
      <WifiOff size={15} /> Reconectando{reconnectDetail ? ` · ${Math.round(reconnectDetail.delayMs / 1000)} s` : ''}
    </>
  ) : wsStatus === 'error_token' ? (
    <>
      <AlertCircle size={15} /> Código inválido · configurar
    </>
  ) : (
    <>
      <WifiOff size={15} /> Desconectado
    </>
  );
  const claseEstado = conectado ? '' : wsStatus === 'error_token' || wsStatus === 'desconectado' ? 'error' : 'alerta';

  return (
    <div className={`tv ${controlesVisibles ? '' : 'sin-cursor'}`}>
      <header className="tv-cabecera">
        <div className="tv-marca">
          {logo ? (
            <img className="tv-logo" src={logo} alt="" />
          ) : (
            <div className="tv-logo-vacio">
              <Dumbbell size={34} />
            </div>
          )}
          <h1 className="tv-nombre">{nombreGimnasio}</h1>
        </div>
        <div className="tv-reloj">
          <div className="tv-hora">{hora}</div>
          <div className="tv-fecha">{fecha}</div>
        </div>
      </header>

      <main className={`tv-cuerpo ${clases.length === 0 ? 'una-columna' : ''}`}>
        <section className="tv-portada">
          <div className="tv-lema">
            Bienvenido
            <span>a entrenar</span>
          </div>
          {avisos.length > 0 && (
            <div key={avisoIndex} className="tv-aviso">
              {avisos[avisoIndex % avisos.length]}
            </div>
          )}
        </section>

        {clases.length > 0 && (
          <section className="tv-clases">
            <h2 className="tv-clases-titulo">Clases de hoy</h2>
            <div className="tv-lista">
              {clases.slice(0, 6).map((clase) => (
                <article key={clase.id} className="tv-clase">
                  <div className="tv-clase-hora">{clase.hora_inicio}</div>
                  <div style={{ minWidth: 0 }}>
                    <div className="tv-clase-nombre">{clase.nombre}</div>
                    {clase.entrenador_nombre && <div className="tv-clase-profe">Con {clase.entrenador_nombre}</div>}
                  </div>
                  <div className={`tv-cupos ${clase.cupos_disponibles > 0 ? '' : 'lleno'}`}>
                    <strong>{clase.cupos_disponibles > 0 ? clase.cupos_disponibles : 'Completo'}</strong>
                    {clase.cupos_disponibles > 0 && <span>cupos</span>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {saludoActivo && (
        <div
          className="tv-saludo"
          key={saludoActivo.clave}
          role="status"
          style={{ '--tv-saludo-duracion': `${displayData?.tiempo_saludo_segundos || 8}s` } as React.CSSProperties}
        >
          <div className="tv-saludo-chico">¡Bienvenido,</div>
          <div className="tv-saludo-nombre">{saludoActivo.nombre.trim().split(/\s+/)[0]}!</div>
          <div className="tv-saludo-gimnasio">{nombreGimnasio}</div>
          <div className="tv-saludo-barra" />
        </div>
      )}

      {!conectado && (
        <button type="button" className={`tv-estado tv-aviso-conexion ${claseEstado}`} onClick={() => setShowTokenModal(true)}>
          {estadoConexion}
        </button>
      )}

      <div className={`tv-controles ${controlesVisibles ? '' : 'oculto'}`}>
        {conectado && (
          <span className="tv-estado" style={{ cursor: 'default' }}>
            {estadoConexion}
          </span>
        )}
        <button type="button" className="tv-control" onClick={toggleFullScreen}>
          <Maximize2 size={15} /> Pantalla completa
        </button>
        <button
          type="button"
          className="tv-control"
          onClick={() => (abiertaDesdePanel ? window.close() : navigate('/inicio'))}
        >
          <ArrowLeft size={15} /> {abiertaDesdePanel ? 'Cerrar' : 'Volver al sistema'}
        </button>
      </div>

      {/* Modal: Device Token Configuration (Ley 1581 / RNF-06) */}
      <Modal
        isOpen={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        title="Conectar pantalla"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowTokenModal(false)}>
              Cerrar
            </Button>
            <Button variant="primary" onClick={handleSaveToken}>
              Conectar pantalla
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          Para mostrar los ingresos en vivo sin exponer datos personales (Ley 1581), el televisor se conecta con el <strong>código de la pantalla</strong> que genera el Jefe en Configuración.
        </p>

        <form onSubmit={handleSaveToken}>
          <Input
            label="Código de la pantalla"
            placeholder="Pega aquí el código"
            value={inputToken}
            onChange={(e) => setInputToken(e.target.value)}
            required
            autoFocus
          />

          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 8 }}>
            Sede conectada: <strong>{activeSubdomain}</strong> · Reconexión automática activa con backoff exponencial (RNF-06).
          </div>
        </form>
      </Modal>
    </div>
  );
};
