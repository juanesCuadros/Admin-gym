import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Users, ShieldCheck, CreditCard, Calendar, UserPlus, ArrowUpRight, Clock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { useCajaTurno } from '../../contexts/CajaTurnoContext';
import { KpiCard, Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Cargando, ErrorCarga, MensajeFijo } from '../../components/estados/Estados';
import { controlIngresoService } from '../../api/controlIngreso.service';
import { clasesService } from '../../api/clases.service';
import { deportistasService } from '../../api/deportistas.service';
import { ResumenIngresosHoyDto } from '../../types/controlIngreso.types';
import { ClaseResponse } from '../../types/clases.types';
import { formatCOP, formatHora } from '../../utils/formato';

const NOMBRE_ROL: Record<string, string> = {
  jefe: 'Jefe',
  recepcionista: 'Recepcionista',
  entrenador: 'Entrenador',
};

/**
 * Inicio. Cada tarjeta pide solo lo que el usuario puede leer; si la API falla o devuelve 0,
 * se muestra el error o el 0. Cero datos inventados (§A7).
 */
export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hasPermission } = useAuth();
  const { tenant } = useTenantTheme();
  const caja = useCajaTurno();

  const permisoPerdido = (location.state as { permisoPerdido?: string } | null)?.permisoPerdido;

  const puedeIngreso = hasPermission('control_ingreso', 'leer');
  const puedeClases = hasPermission('clases', 'leer');
  const puedeDeportistas = hasPermission('deportistas', 'leer');
  const puedeCaja = hasPermission('caja', 'leer');

  const [resumenIngresos, setResumenIngresos] = useState<ResumenIngresosHoyDto | null>(null);
  const [clasesHoy, setClasesHoy] = useState<ClaseResponse[]>([]);
  const [totalDeportistas, setTotalDeportistas] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    const resultados = await Promise.allSettled([
      puedeIngreso ? controlIngresoService.getIngresosHoy() : Promise.resolve(null),
      puedeClases ? clasesService.getClases({ limit: 5 }) : Promise.resolve(null),
      puedeDeportistas ? deportistasService.getDeportistas({ limit: 1 }) : Promise.resolve(null),
    ]);
    const [ingresosRes, clasesRes, depRes] = resultados;

    if (ingresosRes.status === 'fulfilled') setResumenIngresos(ingresosRes.value?.resumen ?? null);
    if (clasesRes.status === 'fulfilled') setClasesHoy(clasesRes.value?.items ?? []);
    if (depRes.status === 'fulfilled') setTotalDeportistas(depRes.value ? depRes.value.total : null);

    const fallo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (fallo) setError(fallo.reason);
    setCargando(false);
  }, [puedeIngreso, puedeClases, puedeDeportistas]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return (
    <div>
      {permisoPerdido && (
        <MensajeFijo tono="advertencia" titulo="Ya no tienes acceso a esa sección" style={{ marginBottom: 20 }}>
          {permisoPerdido}
        </MensajeFijo>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">Inicio</h1>
          <p className="page-subtitle">
            {tenant.nombre} · {user?.nombre} ({NOMBRE_ROL[user?.rol ?? ''] ?? user?.rol})
          </p>
        </div>
        {hasPermission('deportistas', 'crear') && (
          <Button variant="primary" leftIcon={<UserPlus size={16} />} onClick={() => navigate('/deportistas')}>
            Nuevo deportista
          </Button>
        )}
      </div>

      {error !== null && (
        <div style={{ marginBottom: 20 }}>
          <ErrorCarga error={error} onReintentar={cargar} />
        </div>
      )}

      {cargando ? (
        <Cargando filas={4} alto={110} />
      ) : (
        <div className="kpi-grid">
          {puedeDeportistas && (
            <KpiCard
              label="Deportistas registrados"
              value={totalDeportistas ?? '—'}
              icon={<Users size={20} />}
            />
          )}
          {puedeIngreso && (
            <KpiCard
              label="Ingresos de hoy"
              value={resumenIngresos?.total_ingresos ?? '—'}
              icon={<ShieldCheck size={20} />}
              subtext={
                resumenIngresos
                  ? `${resumenIngresos.accesos_abiertos} permitidos · ${resumenIngresos.alertas_mora} en gracia`
                  : undefined
              }
              color="var(--success)"
            />
          )}
          {puedeCaja && (
            <KpiCard
              label="Caja"
              value={
                caja.cargando
                  ? '…'
                  : caja.error
                    ? '—'
                    : caja.turnoAbierto && caja.turno
                      ? formatCOP(caja.turno.total_esperado_efectivo)
                      : 'Cerrada'
              }
              icon={<CreditCard size={20} />}
              subtext={caja.turnoAbierto ? 'Efectivo esperado en el turno' : 'No hay turno abierto'}
              color="var(--secondary)"
            />
          )}
          {puedeClases && (
            <KpiCard
              label="Próximas clases"
              value={clasesHoy.length}
              icon={<Calendar size={20} />}
              color="var(--accent)"
            />
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        <Card title="Acciones rápidas">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {puedeIngreso && (
              <Button
                variant="secondary"
                style={{ justifyContent: 'flex-start', padding: 14 }}
                leftIcon={<ShieldCheck size={18} color="var(--primary)" />}
                onClick={() => navigate('/control-ingreso')}
              >
                Check-in
              </Button>
            )}
            {puedeCaja && (
              <Button
                variant="secondary"
                style={{ justifyContent: 'flex-start', padding: 14 }}
                leftIcon={<CreditCard size={18} color="var(--secondary)" />}
                onClick={() => navigate('/caja')}
              >
                Caja
              </Button>
            )}
            {puedeDeportistas && (
              <Button
                variant="secondary"
                style={{ justifyContent: 'flex-start', padding: 14 }}
                leftIcon={<UserPlus size={18} color="var(--accent)" />}
                onClick={() => navigate('/deportistas')}
              >
                Deportistas
              </Button>
            )}
            {puedeClases && (
              <Button
                variant="secondary"
                style={{ justifyContent: 'flex-start', padding: 14 }}
                leftIcon={<Calendar size={18} color="var(--info)" />}
                onClick={() => navigate('/clases')}
              >
                Clases
              </Button>
            )}
          </div>
        </Card>

        {puedeClases && (
          <Card
            title="Próximas clases"
            action={
              <Button variant="ghost" size="sm" onClick={() => navigate('/clases')} rightIcon={<ArrowUpRight size={14} />}>
                Ver todas
              </Button>
            }
          >
            {cargando ? (
              <Cargando filas={3} alto={52} />
            ) : clasesHoy.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
                No hay clases programadas.
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
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{clase.nombre}</div>
                      <div
                        style={{
                          fontSize: '0.8rem',
                          color: 'var(--text-muted)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <Clock size={12} />
                        {formatHora(clase.fecha_hora)}
                        {(clase.entrenador_nombre || clase.profesor_externo) &&
                          ` · ${clase.entrenador_nombre || clase.profesor_externo}`}
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
        )}
      </div>
    </div>
  );
};
