import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Clock,
  Calendar,
  Sparkles,
  ArrowLeft,
  Volume2,
  Maximize2,
  Dumbbell,
  CheckCircle,
  AlertCircle,
  Wifi,
  WifiOff,
  Key,
} from 'lucide-react';
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
    estado?: string;
    diasRestantes?: number;
  } | null>(null);

  const [avisoIndex, setAvisoIndex] = useState(0);
  const wsClientRef = useRef<PantallaTvWebSocketClient | null>(null);
  const saludoTimeoutRef = useRef<any>(null);

  // Digital clock tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
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
  }, [activeSubdomain]);

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
            estado: event.deportista?.estado_calculado,
            diasRestantes: event.deportista?.dias_restantes_o_vencido,
          });

          const duracionMs = (displayData?.tiempo_saludo_segundos || 8) * 1000;
          saludoTimeoutRef.current = setTimeout(() => {
            setSaludoActivo(null);
          }, duracionMs);
        } else if (event.tipo === 'CONFIG_ACTUALIZADA' && event.configuracion) {
          setDisplayData((prev) =>
            prev
              ? {
                  ...prev,
                  avisos: event.configuracion?.avisos || prev.avisos,
                  tiempo_saludo_segundos:
                    event.configuracion?.tiempo_saludo_segundos || prev.tiempo_saludo_segundos,
                  logo_url: event.configuracion?.logo_url ?? prev.logo_url,
                }
              : null
          );
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
  const avisos = displayData?.avisos ||
    tenant.pantalla_config?.avisos || [
      '¡Bienvenidos a nuestra sede! Recuerda hidratarte durante tu rutina.',
      'Por favor guardar las mancuernas y discos en su lugar al terminar.',
      'Pregunta en recepción por nuestras valoraciones nutricionales personalizadas.',
    ];

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

  const triggerTestSaludo = async () => {
    const nombre = 'Laura Gómez';
    try {
      await pantallaTvService.testSaludo(nombre);
    } catch (err) {
      // Fallback local visual explícitamente etiquetado como no verificado por el servidor
      setSaludoActivo({
        nombre,
        mensaje: `¡Hola, ${nombre}! Bienvenido a entrenar 💪 [Prueba local — no verificada por el servidor]`,
        estado: 'activo',
        diasRestantes: 22,
      });
      setTimeout(() => setSaludoActivo(null), 7000);
    }
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
            <Button variant="ghost" size="sm" onClick={() => navigate('/')} leftIcon={<ArrowLeft size={14} />}>
              Volver al Panel Administrativo
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#070a11',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 9999,
        padding: '36px 48px',
        overflow: 'hidden',
      }}
    >
      {/* Top TV Bar: Controls, Status & Gym Branding */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingBottom: '24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/')}
            leftIcon={<ArrowLeft size={16} />}
            style={{ color: 'rgba(255,255,255,0.7)' }}
          >
            Volver al Panel
          </Button>

          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            <Dumbbell size={26} />
          </div>

          <div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#ffffff' }}>
              {displayData?.nombre_gimnasio || tenant.nombre}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--primary)' }}>
              Lobby & Recepción en Vivo · GymOS ({activeSubdomain})
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* WebSocket Status Indicator (RNF-06) */}
          <div
            onClick={() => setShowTokenModal(true)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 'var(--radius-full)',
              backgroundColor:
                wsStatus === 'conectado'
                  ? 'rgba(16, 185, 129, 0.15)'
                  : wsStatus === 'reconectando' || wsStatus === 'conectando'
                  ? 'rgba(245, 158, 11, 0.15)'
                  : 'rgba(239, 68, 68, 0.15)',
              border: `1px solid ${
                wsStatus === 'conectado'
                  ? 'rgba(16, 185, 129, 0.4)'
                  : wsStatus === 'reconectando' || wsStatus === 'conectando'
                  ? 'rgba(245, 158, 11, 0.4)'
                  : 'rgba(239, 68, 68, 0.4)'
              }`,
              color:
                wsStatus === 'conectado'
                  ? '#10b981'
                  : wsStatus === 'reconectando' || wsStatus === 'conectando'
                  ? '#f59e0b'
                  : '#ef4444',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
            title="Haz clic para configurar el Token de Dispositivo"
          >
            {wsStatus === 'conectado' ? (
              <>
                <Wifi size={14} />
                <span>En Vivo (WS Conectado)</span>
              </>
            ) : wsStatus === 'reconectando' ? (
              <>
                <WifiOff size={14} />
                <span>
                  Reconectando ({reconnectDetail?.attempt || 1}
                  {reconnectDetail ? ` · ${reconnectDetail.delayMs / 1000}s` : ''})...
                </span>
              </>
            ) : wsStatus === 'error_token' ? (
              <>
                <AlertCircle size={14} />
                <span>Token Inválido (Configurar)</span>
              </>
            ) : (
              <>
                <WifiOff size={14} />
                <span>Desconectado</span>
              </>
            )}
          </div>

          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Key size={14} />}
            onClick={() => setShowTokenModal(true)}
            style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
          >
            Token TV
          </Button>

          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Volume2 size={16} />}
            onClick={triggerTestSaludo}
            style={{ backgroundColor: 'rgba(255,255,255,0.08)' }}
          >
            Probar Saludo
          </Button>

          <Button
            variant="outline"
            size="sm"
            leftIcon={<Maximize2 size={16} />}
            onClick={toggleFullScreen}
            style={{ borderColor: 'rgba(255,255,255,0.2)', color: '#ffffff' }}
          >
            Pantalla Completa
          </Button>

          {/* Clock */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(255,255,255,0.06)',
              padding: '8px 20px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            <Clock size={22} color="var(--accent)" />
            <span style={{ fontSize: '1.75rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        </div>
      </div>

      {/* Center Welcome Alert on Real-time Check-in */}
      <div style={{ margin: '32px 0', minHeight: '120px' }}>
        {saludoActivo ? (
          <div
            className="animate-fade-in"
            style={{
              background: 'linear-gradient(135deg, var(--primary) 0%, #1e1b4b 100%)',
              border: '2px solid var(--primary-border)',
              borderRadius: 'var(--radius-xl)',
              padding: '28px 40px',
              display: 'flex',
              alignItems: 'center',
              gap: 24,
              boxShadow: '0 0 50px -10px var(--primary)',
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <CheckCircle size={36} color="#ffffff" />
            </div>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: '0.95rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  opacity: 0.85,
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <span>Control de Acceso</span>
                {saludoActivo.estado && (
                  <span
                    style={{
                      background: 'rgba(255,255,255,0.2)',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                    }}
                  >
                    {saludoActivo.estado.toUpperCase()}
                  </span>
                )}
                {saludoActivo.diasRestantes !== undefined && (
                  <span style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                    ({saludoActivo.diasRestantes} días restantes)
                  </span>
                )}
              </div>
              <div style={{ fontSize: '2.4rem', fontWeight: 800, lineHeight: 1.2 }}>
                {saludoActivo.mensaje}
              </div>
            </div>
          </div>
        ) : (
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 'var(--radius-lg)',
              border: '1px solid rgba(255,255,255,0.06)',
              padding: '24px 32px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
            }}
          >
            <Sparkles size={28} color="var(--accent)" />
            <div style={{ fontSize: '1.25rem', color: 'rgba(255,255,255,0.8)' }}>
              {avisos[avisoIndex]}
            </div>
          </div>
        )}
      </div>

      {/* Main Grid: Today's Classes */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Calendar size={22} color="var(--primary)" />
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff' }}>
            Clases y Sesiones de Hoy
          </h2>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
            flex: 1,
          }}
        >
          {!displayData?.clases_del_dia || displayData.clases_del_dia.length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'rgba(255,255,255,0.4)',
                fontSize: '1.2rem',
              }}
            >
              No hay más clases programadas para el resto del día
            </div>
          ) : (
            displayData.clases_del_dia.map((clase) => (
              <div
                key={clase.id}
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  padding: '22px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  transition: 'all 0.2s ease',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--primary-light)',
                        color: 'var(--primary)',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                      }}
                    >
                      {clase.tipo || 'General'}
                    </span>
                    <span style={{ fontSize: '1.15rem', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>
                      {clase.hora_inicio}
                    </span>
                  </div>

                  <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#ffffff', marginBottom: 4 }}>
                    {clase.nombre}
                  </h3>

                  <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)' }}>
                    Instructor: {clase.entrenador_nombre || 'Staff'}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: 16,
                    paddingTop: 14,
                    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>
                    Cupos disponibles
                  </span>
                  <span
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: 800,
                      color: clase.cupos_disponibles > 0 ? 'var(--success)' : 'var(--danger)',
                    }}
                  >
                    {clase.cupos_disponibles > 0
                      ? `${clase.cupos_disponibles} de ${clase.cupo_maximo}`
                      : 'COMPLETO'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal: Device Token Configuration (Ley 1581 / RNF-06) */}
      <Modal
        isOpen={showTokenModal}
        onClose={() => setShowTokenModal(false)}
        title="Configuración de Token de Dispositivo (Pantalla TV)"
        footer={
          <>
            <Button variant="outline" onClick={() => setShowTokenModal(false)}>
              Cerrar
            </Button>
            <Button variant="primary" onClick={handleSaveToken}>
              Conectar Pantalla
            </Button>
          </>
        }
      >
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          Para autorizar la recepción de eventos de check-in en vivo sin comprometer datos personales (Ley 1581), el televisor físico debe conectarse con el <strong>Token de Dispositivo</strong> generado por el Jefe en la pantalla de Configuración.
        </p>

        <form onSubmit={handleSaveToken}>
          <Input
            label="Token de Dispositivo (device_token)"
            placeholder="Introduce el token alfanumérico..."
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
