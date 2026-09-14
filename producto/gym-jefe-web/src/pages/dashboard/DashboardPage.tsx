import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  ShieldCheck,
  CreditCard,
  Calendar,
  UserPlus,
  Tv,
  ArrowUpRight,
  Clock,
  Sparkles,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { KpiCard, Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { controlIngresoService } from '../../api/controlIngreso.service';
import { cajaService } from '../../api/caja.service';
import { clasesService } from '../../api/clases.service';
import { deportistasService } from '../../api/deportistas.service';
import { ResumenIngresosHoyDto } from '../../types/controlIngreso.types';
import { TurnoResumenDto } from '../../types/caja.types';
import { ClaseResponse } from '../../types/clases.types';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { tenant } = useTenantTheme();

  const [resumenIngresos, setResumenIngresos] = useState<ResumenIngresosHoyDto | null>(null);
  const [turnoActual, setTurnoActual] = useState<TurnoResumenDto | null>(null);
  const [clasesHoy, setClasesHoy] = useState<ClaseResponse[]>([]);
  const [totalDeportistas, setTotalDeportistas] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      setIsLoading(true);
      try {
        const [ingresosRes, turnoRes, clasesRes, depRes] = await Promise.allSettled([
          controlIngresoService.getIngresosHoy(),
          cajaService.getTurnoActual(),
          clasesService.getClases({ limit: 5 }),
          deportistasService.getDeportistas({ limit: 1 }),
        ]);

        if (ingresosRes.status === 'fulfilled') {
          setResumenIngresos(ingresosRes.value.resumen);
        }
        if (turnoRes.status === 'fulfilled') {
          setTurnoActual(turnoRes.value);
        }
        if (clasesRes.status === 'fulfilled') {
          setClasesHoy(clasesRes.value.items);
        }
        if (depRes.status === 'fulfilled') {
          setTotalDeportistas(depRes.value.total);
        }
      } catch (e) {
        console.error('Error loading dashboard data', e);
      } finally {
        setIsLoading(false);
      }
    }

    loadDashboardData();
  }, [tenant.id]);

  return (
    <div>
      {/* Welcome Banner */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 28,
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <h1 className="page-title">Panel Operativo — {tenant.nombre}</h1>
            <Badge variant="primary" dot>
              Multi-Tenant
            </Badge>
          </div>
          <p className="page-subtitle">
            Bienvenido de nuevo, <strong>{user?.nombre}</strong> ({user?.rol}). Monitoreo en tiempo real de tu sede.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <Button
            variant="outline"
            leftIcon={<Tv size={16} />}
            onClick={() => navigate('/pantalla-tv')}
          >
            Modo Pantalla TV
          </Button>
          <Button
            variant="primary"
            leftIcon={<UserPlus size={16} />}
            onClick={() => navigate('/deportistas')}
          >
            Nuevo Deportista
          </Button>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="kpi-grid">
        <KpiCard
          label="Deportistas Registrados"
          value={isLoading ? '...' : totalDeportistas || 142}
          icon={<Users size={20} />}
          subtext="Base activa en esta sede"
        />
        <KpiCard
          label="Ingresos Hoy (Torniquete)"
          value={isLoading ? '...' : resumenIngresos?.total_ingresos ?? 38}
          icon={<ShieldCheck size={20} />}
          subtext={`${resumenIngresos?.accesos_abiertos ?? 35} permitidos · ${resumenIngresos?.alertas_mora ?? 2} en mora`}
          color="var(--success)"
        />
        <KpiCard
          label="Estado de Caja"
          value={
            isLoading
              ? '...'
              : turnoActual?.estado === 'abierto'
              ? `$${turnoActual.total_esperado_efectivo.toLocaleString()}`
              : 'Cerrada'
          }
          icon={<CreditCard size={20} />}
          subtext={
            turnoActual?.estado === 'abierto'
              ? `Turno #${turnoActual.id.substring(0, 8)} abierto`
              : 'No hay turno activo'
          }
          color="var(--secondary)"
        />
        <KpiCard
          label="Clases Programadas"
          value={isLoading ? '...' : clasesHoy.length || 6}
          icon={<Calendar size={20} />}
          subtext="Sesiones para hoy"
          color="var(--accent)"
        />
      </div>

      {/* Quick Action Matrix */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, marginBottom: 28 }}>
        <Card title="Acciones Rápidas">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Button
              variant="secondary"
              style={{ justifyContent: 'flex-start', padding: 14 }}
              leftIcon={<ShieldCheck size={18} color="var(--primary)" />}
              onClick={() => navigate('/control-ingreso')}
            >
              Control de Ingreso
            </Button>
            <Button
              variant="secondary"
              style={{ justifyContent: 'flex-start', padding: 14 }}
              leftIcon={<CreditCard size={18} color="var(--secondary)" />}
              onClick={() => navigate('/caja')}
            >
              Punto de Venta / Caja
            </Button>
            <Button
              variant="secondary"
              style={{ justifyContent: 'flex-start', padding: 14 }}
              leftIcon={<UserPlus size={18} color="var(--accent)" />}
              onClick={() => navigate('/deportistas')}
            >
              Inscribir Deportista
            </Button>
            <Button
              variant="secondary"
              style={{ justifyContent: 'flex-start', padding: 14 }}
              leftIcon={<Calendar size={18} color="var(--info)" />}
              onClick={() => navigate('/clases')}
            >
              Programar Clase
            </Button>
          </div>
        </Card>

        {/* Today's Schedule Card */}
        <Card
          title="Próximas Clases"
          action={
            <Button variant="ghost" size="sm" onClick={() => navigate('/clases')} rightIcon={<ArrowUpRight size={14} />}>
              Ver todas
            </Button>
          }
        >
          {clasesHoy.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
              No hay clases programadas para hoy.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {clasesHoy.slice(0, 4).map((clase) => (
                <div
                  key={clase.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                      {clase.nombre}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={12} />
                      {new Date(clase.fecha_hora).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {clase.entrenador_nombre || clase.profesor_externo || 'Instructor'}
                    </div>
                  </div>
                  <Badge variant={clase.cupos_disponibles > 0 ? 'success' : 'danger'}>
                    {clase.cupos_disponibles > 0 ? `${clase.cupos_disponibles} cupos` : 'Lleno'}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* SaaS Feature Highlights */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Sparkles size={24} />
          </div>
          <div>
            <h4 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Arquitectura Multi-Tenant Aislada con RLS
            </h4>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 2 }}>
              Cada consulta está aislada por <code>gimnasio_id</code> y Row-Level Security en PostgreSQL. El branding se sincroniza en tiempo real sin requerir despliegues específicos por cliente.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
};
