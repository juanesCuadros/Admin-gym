import React, { useMemo } from 'react';
import { Award, CheckCircle2, Clock } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { plural } from '../../../utils/formato';
import { formatFechaNegocio, hoyBogota } from '../../../utils/fechasBogota';
import type { AsistenciasPortalResponse } from '../../../types/portal.types';

interface TabMisAsistenciasProps {
  asistencias: AsistenciasPortalResponse;
}

export const TabMisAsistencias: React.FC<TabMisAsistenciasProps> = ({ asistencias }) => {
  const calendarioMesData = useMemo(() => {
    const hoy = hoyBogota();
    const [anioStr, mesStr] = hoy.split('-');
    const anio = Number(anioStr);
    const mes = Number(mesStr);
    const ultimoDia = new Date(anio, mes, 0).getDate();
    const setAsistidos = new Set(asistencias.dias_asistidos_mes || []);

    const primerDiaFecha = new Date(anio, mes - 1, 1);
    const offsetInicio = (primerDiaFecha.getDay() + 6) % 7;

    const nombreMes = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(primerDiaFecha);
    const mesTitulo = nombreMes.charAt(0).toUpperCase() + nombreMes.slice(1);

    const dias: Array<{ dia: number; fecha: string; asistio: boolean; esHoy: boolean; esPasado: boolean; esFuturo: boolean }> = [];
    for (let d = 1; d <= ultimoDia; d++) {
      const f = `${anioStr}-${mesStr}-${String(d).padStart(2, '0')}`;
      dias.push({
        dia: d,
        fecha: f,
        asistio: setAsistidos.has(f),
        esHoy: f === hoy,
        esPasado: f < hoy,
        esFuturo: f > hoy,
      });
    }

    return {
      mesTitulo,
      offsetInicio,
      dias,
    };
  }, [asistencias]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* KPIs de Asistencias (Consolidados sin redundancias) */}
      <div className="portal-kpi-grid">
        <div className="card portal-kpi-card">
          <div>
            <div className="portal-kpi-title" style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Asistencias Este Mes
            </div>
            <div className="portal-kpi-val" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--primary)', marginTop: 4 }}>
              {plural(asistencias.asistencias_mes_actual, 'día', 'días')}
            </div>
          </div>
          <div className="portal-kpi-sub" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            Últimos 30 días: {asistencias.asistencias_ultimos_30_dias} ingresos
          </div>
        </div>

        <div className="card portal-kpi-card">
          <div>
            <div className="portal-kpi-title" style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Total Histórico
            </div>
            <div className="portal-kpi-val" style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
              {plural(asistencias.asistencias_totales, 'entrenamiento', 'entrenamientos')}
            </div>
          </div>
          <div className="portal-kpi-sub" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            1 día con registro = 1 entrenamiento
          </div>
        </div>
      </div>

      {/* Calendario Real de 7 Columnas */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Award size={18} style={{ color: 'var(--primary)' }} />
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
              {calendarioMesData.mesTitulo}
            </h3>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {plural(asistencias.asistencias_mes_actual, 'día entrenado', 'días entrenados')}
          </div>
        </div>

        {/* Encabezado L M M J V S D */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 6,
            marginBottom: 6,
            textAlign: 'center',
          }}
        >
          {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
            <div
              key={i}
              style={{
                fontSize: '0.74rem',
                fontWeight: 600,
                color: 'var(--text-secondary)',
                padding: '3px 0',
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Rejilla de días */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7, 1fr)',
            gap: 6,
          }}
        >
          {Array.from({ length: calendarioMesData.offsetInicio }).map((_, i) => (
            <div key={`empty-${i}`} style={{ height: 40 }} />
          ))}

          {calendarioMesData.dias.map((d) => {
            let fondo = 'var(--bg-surface-elevated)';
            let colorTexto = 'var(--text-secondary)';
            let borde = '1px solid var(--border-color)';
            let opacidad = 1;

            if (d.asistio) {
              fondo = 'var(--primary)';
              colorTexto = '#ffffff';
              borde = d.esHoy ? '2px solid var(--accent, #f59e0b)' : '1px solid transparent';
            } else if (d.esHoy) {
              borde = '2px solid var(--primary)';
              colorTexto = 'var(--text-primary)';
            } else if (d.esFuturo) {
              opacidad = 0.35;
            }

            return (
              <div
                key={d.fecha}
                title={
                  d.asistio
                    ? `Asististe el ${formatFechaNegocio(d.fecha)}`
                    : d.esHoy
                    ? 'Hoy'
                    : formatFechaNegocio(d.fecha)
                }
                style={{
                  height: 40,
                  borderRadius: 7,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  background: fondo,
                  color: colorTexto,
                  border: borde,
                  opacity: opacidad,
                }}
              >
                <span>{d.dia}</span>
                {d.asistio && <CheckCircle2 size={10} style={{ marginTop: 1 }} />}
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 12, fontSize: '0.74rem', color: 'var(--text-muted)', textAlign: 'center' }}>
          Cada día con acceso registrado cuenta como 1 día entrenado.
        </div>
      </div>

      {/* Registro Cronológico de Asistencias (Desktop Table + Mobile Cards) */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Clock size={18} style={{ color: 'var(--primary)' }} />
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
            Registro Cronológico de Asistencias ({asistencias.historial.length})
          </h3>
        </div>

        {asistencias.historial.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
            Aún no registras asistencias en el gimnasio.
          </div>
        ) : (
          <>
            <div className="portal-desktop-only">
              <div className="table-responsive">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Hora de Ingreso</th>
                      <th>Método</th>
                      <th>Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asistencias.historial.map((item) => (
                      <tr key={item.id}>
                        <td>{formatFechaNegocio(item.fecha_local)}</td>
                        <td>{item.hora_local} hrs</td>
                        <td style={{ textTransform: 'capitalize' }}>
                          {item.metodo === 'huella' ? 'Huella dactilar' : 'Recepción (Manual)'}
                        </td>
                        <td>
                          <Badge
                            variant={
                              item.resultado === 'abrio'
                                ? 'success'
                                : item.resultado === 'alerta_mora'
                                ? 'warning'
                                : 'danger'
                            }
                          >
                            {item.resultado === 'abrio'
                              ? 'Ingreso Autorizado'
                              : item.resultado === 'alerta_mora'
                              ? 'Ingreso en Gracia'
                              : 'Denegado'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="portal-mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {asistencias.historial.map((item) => (
                <div key={item.id} className="portal-mobile-table-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{formatFechaNegocio(item.fecha_local)}</span>
                    <Badge
                      variant={
                        item.resultado === 'abrio'
                          ? 'success'
                          : item.resultado === 'alerta_mora'
                          ? 'warning'
                          : 'danger'
                      }
                    >
                      {item.resultado === 'abrio'
                        ? 'Autorizado'
                        : item.resultado === 'alerta_mora'
                        ? 'En Gracia'
                        : 'Denegado'}
                    </Badge>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                    <span>Hora: {item.hora_local} hrs</span>
                    <span>{item.metodo === 'huella' ? 'Huella dactilar' : 'Recepción manual'}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

