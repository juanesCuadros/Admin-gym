import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Users,
  ShieldCheck,
  CreditCard,
  Calendar,
  CalendarDays,
  UserPlus,
  ArrowUpRight,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
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
import { formatCOP, formatDiaMes, formatHora, ZONA_HORARIA } from '../../utils/formato';

/** "martes, 20 de octubre" en America/Bogota. */
const formatoFechaLarga = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA_HORARIA,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const formatoHoraNum = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HORARIA, hour: 'numeric', hour12: false });

const capitalizar = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function saludo(): string {
  const h = Number(formatoHoraNum.format(new Date())) % 24;
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

interface AccionRapida {
  clave: string;
  titulo: string;
  ruta: string;
  icono: React.ReactNode;
}

/**
 * Inicio. Cada tarjeta pide solo lo que el usuario puede leer; si la API falla o devuelve 0,
 * se muestra el error o el 0. Cero datos inventados (§A7).
 */
export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, hasPermission } = useAuth();
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

  const primerNombre = user?.nombre?.split(' ')[0] ?? '';

  const acciones: AccionRapida[] = [
    puedeIngreso && {
      clave: 'checkin',
      titulo: 'Check-in',
      ruta: '/control-ingreso',
      icono: <ShieldCheck size={18} />,
    },
    puedeCaja && {
      clave: 'caja',
      titulo: 'Caja',
      ruta: '/caja',
      icono: <CreditCard size={18} />,
    },
    puedeDeportistas && {
      clave: 'deportistas',
      titulo: 'Deportistas',
      ruta: '/deportistas',
      icono: <Users size={18} />,
    },
    puedeClases && {
      clave: 'clases',
      titulo: 'Clases',
      ruta: '/clases',
      icono: <Calendar size={18} />,
    },
  ].filter(Boolean) as AccionRapida[];

  return (
    <div>
      {permisoPerdido && (
        <MensajeFijo tono="advertencia" titulo="Ya no tienes acceso a esa sección" style={{ marginBottom: 20 }}>
          {permisoPerdido}
        </MensajeFijo>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">
            {saludo()}
            {primerNombre ? `, ${primerNombre}` : ''}
          </h1>
          <p className="page-subtitle">{capitalizar(formatoFechaLarga.format(new Date()))}</p>
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
        <div className="kpi-grid">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 118 }} />
          ))}
        </div>
      ) : (
        <div className="kpi-grid">
          {puedeDeportistas && (
            <KpiCard
              label="Deportistas registrados"
              value={totalDeportistas ?? '—'}
              icon={<Users size={18} />}
            />
          )}
          {puedeIngreso && (
            <KpiCard
              label="Ingresos de hoy"
              value={resumenIngresos?.total_ingresos ?? '—'}
              icon={<ShieldCheck size={18} />}
              subtext={
                resumenIngresos
                  ? `${resumenIngresos.accesos_abiertos} permitidos · ${resumenIngresos.alertas_mora} en gracia`
                  : undefined
              }
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
              icon={<CreditCard size={18} />}
              subtext={caja.turnoAbierto ? 'Efectivo esperado en el turno' : 'No hay turno abierto'}
            />
          )}
          {puedeClases && (
            <KpiCard
              label="Próximas clases"
              value={clasesHoy.length}
              icon={<Calendar size={18} />}
            />
          )}
        </div>
      )}

      <div className="dash-grid">
        {acciones.length > 0 && (
          <Card title="Acciones rápidas">
            <div className="quick-actions">
              {acciones.map((a) => (
                <button
                  key={a.clave}
                  type="button"
                  className="quick-action"
                  onClick={() => navigate(a.ruta)}
                >
                  <span className="quick-action-icon">{a.icono}</span>
                  <span className="quick-action-title">{a.titulo}</span>
                  <ArrowRight size={16} className="quick-action-arrow" />
                </button>
              ))}
            </div>
          </Card>
        )}

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
              <Cargando filas={3} alto={56} />
            ) : clasesHoy.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">
                  <CalendarDays size={24} />
                </div>
                <div className="empty-state-title">No hay clases programadas</div>
                <p className="empty-state-text">Las clases que agendes aparecerán aquí.</p>
              </div>
            ) : (
              <div className="class-list">
                {clasesHoy.slice(0, 4).map((clase) => (
                  <div key={clase.id} className="class-item">
                    <div className="class-time">{formatDiaMes(clase.fecha_hora)}</div>
                    <div className="class-info">
                      <div className="class-name">{clase.nombre}</div>
                      <div className="class-meta">
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
