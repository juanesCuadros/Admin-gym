import React, { useMemo, useState } from 'react';
import { Activity, Plus, Scale, TrendingDown, TrendingUp } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { formatDecimal } from '../../../utils/formato';
import { formatFechaNegocio } from '../../../utils/fechasBogota';
import type { MedicionesPortalResponse } from '../../../types/portal.types';
import type { MetricaGrafica } from '../types';

interface TabMedidasProgresoProps {
  mediciones: MedicionesPortalResponse;
  onAbrirNuevaMedida: () => void;
}

export const TabMedidasProgreso: React.FC<TabMedidasProgresoProps> = ({
  mediciones,
  onAbrirNuevaMedida,
}) => {
  const [metricaGrafica, setMetricaGrafica] = useState<MetricaGrafica>('peso');

  const formatoFechaGrafica = useMemo(
    () => new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' }),
    []
  );

  const deltaVsAnterior = useMemo(() => {
    if (!mediciones?.historial || mediciones.historial.length < 2) return null;
    const actual = mediciones.historial[0];
    const anterior = mediciones.historial[1];

    const diff = (a: string | number | null | undefined, b: string | number | null | undefined) => {
      if (a === null || a === undefined || b === null || b === undefined) return null;
      const numA = Number(a);
      const numB = Number(b);
      if (!Number.isFinite(numA) || !Number.isFinite(numB)) return null;
      return numA - numB;
    };

    return {
      peso: diff(actual.peso, anterior.peso),
      grasa: diff(actual.grasa_pct, anterior.grasa_pct),
      musculo: diff(actual.masa_muscular, anterior.masa_muscular),
      cintura: diff(actual.cintura, anterior.cintura),
    };
  }, [mediciones]);

  const puntosGrafica = useMemo(() => {
    if (!mediciones?.historial?.length) return [];
    return [...mediciones.historial]
      .reverse()
      .map((item) => {
        const raw = item[metricaGrafica];
        const valor = raw !== null && raw !== undefined ? Number(raw) : null;
        return {
          fecha: item.fecha,
          valor: valor !== null && Number.isFinite(valor) ? valor : null,
        };
      })
      .filter((p): p is { fecha: string; valor: number } => p.valor !== null);
  }, [mediciones, metricaGrafica]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.12rem', fontWeight: 700 }}>Mi Progreso Corporal</h2>
          <p style={{ margin: '3px 0 0', fontSize: '0.84rem', color: 'var(--text-secondary)' }}>
            Registra tus medidas y visualiza tu evolución en el tiempo.
          </p>
        </div>
        <Button variant="primary" size="sm" leftIcon={<Plus size={16} />} onClick={onAbrirNuevaMedida}>
          Agregar medidas
        </Button>
      </div>

      {/* KPIs de medidas (2 cols en móvil) */}
      <div className="portal-kpi-grid-4">
        {[
          {
            titulo: 'Peso Corporal',
            actual: mediciones.resumen.peso_actual,
            deltaAnt: deltaVsAnterior?.peso,
            unidad: 'kg',
          },
          {
            titulo: '% Grasa Corporal',
            actual: mediciones.resumen.grasa_actual,
            deltaAnt: deltaVsAnterior?.grasa,
            unidad: '%',
          },
          {
            titulo: 'Masa Muscular',
            actual: mediciones.resumen.musculo_actual,
            deltaAnt: deltaVsAnterior?.musculo,
            unidad: 'kg',
          },
          {
            titulo: 'Cintura',
            actual: mediciones.resumen.cintura_actual,
            deltaAnt: deltaVsAnterior?.cintura,
            unidad: 'cm',
          },
        ].map((card, i) => {
          const act = card.actual !== null && card.actual !== undefined ? Number(card.actual) : null;
          const dAnt = card.deltaAnt !== null && card.deltaAnt !== undefined ? Number(card.deltaAnt) : null;
          return (
            <div key={i} className="card portal-kpi-card">
              <div>
                <div className="portal-kpi-title" style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
                  {card.titulo}
                </div>
                <div className="portal-kpi-val" style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: 4 }}>
                  {act !== null ? `${formatDecimal(act)} ${card.unidad}` : '—'}
                </div>
              </div>
              {mediciones.resumen.total_registros > 1 && dAnt !== null ? (
                <div
                  className="portal-kpi-sub"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.76rem',
                    marginTop: 4,
                    color: dAnt > 0 ? 'var(--primary)' : dAnt < 0 ? 'var(--success, #16a34a)' : 'var(--text-muted)',
                    fontWeight: 600,
                  }}
                >
                  {dAnt > 0 ? <TrendingUp size={13} /> : dAnt < 0 ? <TrendingDown size={13} /> : null}
                  <span>
                    {dAnt > 0 ? `+${formatDecimal(dAnt)}` : formatDecimal(dAnt)} {card.unidad} vs anterior
                  </span>
                </div>
              ) : (
                <div className="portal-kpi-sub" style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  {act !== null ? '1er registro base' : 'Sin registros'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Gráfica SVG de Evolución */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Activity size={18} style={{ color: 'var(--primary)' }} />
            <span style={{ fontWeight: 700, fontSize: '0.98rem' }}>Curva de Evolución</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { key: 'peso' as MetricaGrafica, label: 'Peso' },
              { key: 'grasa_pct' as MetricaGrafica, label: '% Grasa' },
              { key: 'masa_muscular' as MetricaGrafica, label: 'M. Muscular' },
              { key: 'cintura' as MetricaGrafica, label: 'Cintura' },
            ].map((m) => (
              <Button
                key={m.key}
                size="sm"
                variant={metricaGrafica === m.key ? 'primary' : 'outline'}
                onClick={() => setMetricaGrafica(m.key)}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </div>

        {puntosGrafica.length < 2 ? (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 50,
                height: 50,
                borderRadius: '50%',
                background: 'var(--bg-surface-elevated)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
              }}
            >
              <Scale size={26} />
            </div>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
              Agrega otra medición para ver tu evolución
            </div>
            <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-secondary)', maxWidth: 360 }}>
              Se necesitan al menos 2 registros para trazar la curva física comparativa.
            </p>
          </div>
        ) : (
          <div style={{ width: '100%', overflowX: 'auto' }}>
            {(() => {
              const valores = puntosGrafica.map((p) => p.valor);
              const minVal = Math.min(...valores);
              const maxVal = Math.max(...valores);
              const rango = Math.max(0.5, maxVal - minVal);
              const ancho = Math.max(500, puntosGrafica.length * 90);
              const alto = 210;
              const padIzq = 62;
              const padDer = 35;
              const padArr = 24;
              const padAbj = 32;

              const plotWidth = ancho - padIzq - padDer;
              const plotHeight = alto - padArr - padAbj;

              const unidad =
                metricaGrafica === 'peso' || metricaGrafica === 'masa_muscular'
                  ? 'kg'
                  : metricaGrafica === 'grasa_pct'
                  ? '%'
                  : 'cm';

              const coords = puntosGrafica.map((p, idx) => {
                const x = padIzq + (idx / (puntosGrafica.length - 1)) * plotWidth;
                const y = padArr + plotHeight - ((p.valor - minVal) / rango) * plotHeight;
                return { x, y, ...p };
              });

              const polylinePoints = coords.map((c) => `${c.x},${c.y}`).join(' ');

              const gridSteps = [
                { val: maxVal, y: padArr },
                { val: (maxVal + minVal) / 2, y: padArr + plotHeight / 2 },
                { val: minVal, y: padArr + plotHeight },
              ];

              return (
                <svg
                  width="100%"
                  viewBox={`0 0 ${ancho} ${alto}`}
                  style={{ minWidth: 460, height: 210, overflow: 'visible' }}
                >
                  {gridSteps.map((gs, i) => (
                    <g key={i}>
                      <line
                        x1={padIzq}
                        y1={gs.y}
                        x2={ancho - padDer}
                        y2={gs.y}
                        stroke="var(--border-color)"
                        strokeDasharray={i === 2 ? undefined : '3 3'}
                        strokeWidth="1"
                      />
                      <text
                        x={padIzq - 10}
                        y={gs.y + 4}
                        textAnchor="end"
                        fontSize="11"
                        fill="var(--text-secondary)"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {formatDecimal(gs.val)} {unidad}
                      </text>
                    </g>
                  ))}

                  <polyline
                    fill="none"
                    stroke="var(--primary)"
                    strokeWidth="3"
                    points={polylinePoints}
                  />

                  {coords.map((c, idx) => {
                    const fechaObj = new Date(`${c.fecha}T12:00:00`);
                    const fechaCorta = Number.isNaN(fechaObj.getTime())
                      ? c.fecha.slice(5)
                      : formatoFechaGrafica.format(fechaObj);
                    return (
                      <g key={idx}>
                        <circle cx={c.x} cy={c.y} r={5} fill="var(--primary)" stroke="var(--bg-surface)" strokeWidth={2} />
                        <text
                          x={c.x}
                          y={c.y - 10}
                          textAnchor="middle"
                          fontSize="11"
                          fontWeight="700"
                          fill="var(--text-primary)"
                        >
                          {formatDecimal(c.valor)}
                        </text>
                        <text
                          x={c.x}
                          y={alto - 10}
                          textAnchor="middle"
                          fontSize="11"
                          fill="var(--text-secondary)"
                        >
                          {fechaCorta}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              );
            })()}
          </div>
        )}
      </div>

      {/* Historial de Mediciones (Desktop Table + Mobile Cards) */}
      <div className="card" style={{ padding: '18px 20px' }}>
        <h3 style={{ margin: '0 0 14px', fontSize: '1rem', fontWeight: 700 }}>
          Historial de Mediciones ({mediciones.historial.length})
        </h3>
        {mediciones.historial.length === 0 ? (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
            Todavía no tienes mediciones registradas.
          </div>
        ) : (
          <>
            {/* Vista Desktop (Tabla completa) */}
            <div className="portal-desktop-only">
              <div className="table-responsive">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th className="col-num">Peso</th>
                      <th className="col-num">IMC</th>
                      <th className="col-num">% Grasa</th>
                      <th className="col-num">Masa Musc.</th>
                      <th className="col-num">Cintura</th>
                      <th className="col-num">Cadera</th>
                      <th className="col-num">Pecho</th>
                      <th className="col-num">Brazo / Pierna</th>
                      <th>Origen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mediciones.historial.map((m) => (
                      <tr key={m.id}>
                        <td>{formatFechaNegocio(m.fecha)}</td>
                        <td className="col-num">{m.peso ? `${formatDecimal(m.peso)} kg` : '—'}</td>
                        <td className="col-num">{m.imc ? formatDecimal(m.imc) : '—'}</td>
                        <td className="col-num">{m.grasa_pct ? `${formatDecimal(m.grasa_pct)}%` : '—'}</td>
                        <td className="col-num">{m.masa_muscular ? `${formatDecimal(m.masa_muscular)} kg` : '—'}</td>
                        <td className="col-num">{m.cintura ? `${formatDecimal(m.cintura)} cm` : '—'}</td>
                        <td className="col-num">{m.cadera ? `${formatDecimal(m.cadera)} cm` : '—'}</td>
                        <td className="col-num">{m.pecho ? `${formatDecimal(m.pecho)} cm` : '—'}</td>
                        <td className="col-num">
                          {m.brazo || m.pierna
                            ? `${m.brazo ? `${formatDecimal(m.brazo)}` : '—'} / ${
                                m.pierna ? `${formatDecimal(m.pierna)}` : '—'
                              } cm`
                            : '—'}
                        </td>
                        <td>
                          <Badge variant={m.origen === 'staff' ? 'info' : 'neutral'}>
                            {m.origen === 'staff' ? `Staff (${m.registrado_por_nombre || 'Entrenador'})` : 'Registrado por ti'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Vista Móvil (Tarjetas de cada medición) */}
            <div className="portal-mobile-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {mediciones.historial.map((m) => (
                <div key={m.id} className="portal-mobile-table-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.92rem' }}>{formatFechaNegocio(m.fecha)}</span>
                    <Badge variant={m.origen === 'staff' ? 'info' : 'neutral'}>
                      {m.origen === 'staff' ? 'Staff' : 'Por ti'}
                    </Badge>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: '8px 12px',
                      paddingTop: 4,
                      borderTop: '1px solid var(--border-color)',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Peso</div>
                      <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
                        {m.peso ? `${formatDecimal(m.peso)} kg` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>IMC</div>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>{m.imc ? formatDecimal(m.imc) : '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>% Grasa</div>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem', color: 'var(--primary)' }}>
                        {m.grasa_pct ? `${formatDecimal(m.grasa_pct)}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Masa Musc.</div>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                        {m.masa_muscular ? `${formatDecimal(m.masa_muscular)} kg` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Cintura</div>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                        {m.cintura ? `${formatDecimal(m.cintura)} cm` : '—'}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>Cadera</div>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem' }}>
                        {m.cadera ? `${formatDecimal(m.cadera)} cm` : '—'}
                      </div>
                    </div>
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

