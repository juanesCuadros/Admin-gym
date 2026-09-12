import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock,
  Calendar,
  Sparkles,
  ArrowLeft,
  Volume2,
  Maximize2,
  Dumbbell,
  CheckCircle,
} from 'lucide-react';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { pantallaTvService } from '../../api/pantallaTv.service';
import { clasesService } from '../../api/clases.service';
import { ClaseResponse } from '../../types/clases.types';
import { Button } from '../../components/ui/Button';

export const PantallaTvPage: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useTenantTheme();

  const [currentTime, setCurrentTime] = useState(new Date());
  const [clases, setClases] = useState<ClaseResponse[]>([]);
  const [saludoActivo, setSaludoActivo] = useState<string | null>('¡Bienvenido, Deportista!');
  const [avisoIndex, setAvisoIndex] = useState(0);

  // Digital clock tick
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch classes
  useEffect(() => {
    async function loadData() {
      try {
        const res = await clasesService.getClases({ limit: 6 });
        setClases(res.items);
      } catch (e) {
        console.error('Error loading classes for TV display', e);
      }
    }
    loadData();
  }, [tenant.id]);

  // Rotate notices
  const avisos = tenant.pantalla_config?.avisos || [
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

  const triggerTestSaludo = async () => {
    const nombre = 'Laura Gómez';
    setSaludoActivo(`¡Hola, ${nombre}! Bienvenido a entrenar 💪`);
    try {
      await pantallaTvService.testSaludo(nombre);
    } catch {
      // Handled visually
    }

    setTimeout(() => {
      setSaludoActivo(null);
    }, 7000);
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

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
      {/* Top TV Bar: Controls & Gym Branding */}
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
              {tenant.nombre}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--primary)' }}>
              Lobby & Recepción en Vivo · GymOS
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Volume2 size={16} />}
            onClick={triggerTestSaludo}
            style={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
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

      {/* Center Welcome Alert on Check-in */}
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
            <div>
              <div style={{ fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.85 }}>
                Control de Acceso
              </div>
              <div style={{ fontSize: '2.4rem', fontWeight: 800, lineHeight: 1.2 }}>
                {saludoActivo}
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
          {clases.length === 0 ? (
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
            clases.map((clase) => (
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
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
                      {new Date(clase.fecha_hora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#ffffff', marginBottom: 4 }}>
                    {clase.nombre}
                  </h3>

                  <div style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)' }}>
                    Instructor: {clase.entrenador_nombre || clase.profesor_externo || 'Staff'}
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
                    {clase.cupos_disponibles > 0 ? `${clase.cupos_disponibles} de ${clase.cupo}` : 'COMPLETO'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
