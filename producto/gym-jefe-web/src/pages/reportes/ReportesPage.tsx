import React from 'react';
import { BarChart3, TrendingUp, Users, Calendar, ArrowUpRight, DollarSign } from 'lucide-react';
import { Card, KpiCard } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

export const ReportesPage: React.FC = () => {
  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reportes y Métricas Operativas</h1>
          <p className="page-subtitle">
            Consolidado financiero, retención de miembros, aforo horario e ingresos de la sede
          </p>
        </div>
      </div>

      <div className="kpi-grid">
        <KpiCard
          label="Ingresos Mes Actual"
          value="$14,850,000"
          icon={<DollarSign size={20} />}
          subtext="+12.4% vs mes anterior"
          color="var(--success)"
        />
        <KpiCard
          label="Tasa de Retención"
          value="84.2%"
          icon={<TrendingUp size={20} />}
          subtext="Renovaciones de membresía"
          color="var(--primary)"
        />
        <KpiCard
          label="Horas Pico de Aforo"
          value="6:00 - 8:30 PM"
          icon={<Users size={20} />}
          subtext="Promedio 48 personas simultáneas"
          color="var(--accent)"
        />
        <KpiCard
          label="Ocupación de Clases"
          value="91.5%"
          icon={<Calendar size={20} />}
          subtext="Cupos reservados vs disponibles"
          color="var(--secondary)"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>
        <Card title="Distribución de Ingresos por Concepto">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              { concepto: 'Membresías Mensuales / Trimestrales', monto: '$11,400,000', pct: 76.7, color: 'var(--primary)' },
              { concepto: 'Venta de Productos (Bebidas / Suplementos)', monto: '$2,150,000', pct: 14.5, color: 'var(--secondary)' },
              { concepto: 'Pases de Día y Clases Sueltas', monto: '$1,300,000', pct: 8.8, color: 'var(--accent)' },
            ].map((item, idx) => (
              <div key={idx}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.875rem' }}>
                  <span style={{ fontWeight: 600 }}>{item.concepto}</span>
                  <span style={{ fontWeight: 700 }}>{item.monto} ({item.pct}%)</span>
                </div>
                <div
                  style={{
                    height: 8,
                    borderRadius: 'var(--radius-full)',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${item.pct}%`,
                      backgroundColor: item.color,
                      borderRadius: 'var(--radius-full)',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Estado del Padrón de Deportistas">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ padding: '16px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-elevated)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Afiliados al Día</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--success)', marginTop: 4 }}>118</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>83.1% del padrón</div>
            </div>

            <div style={{ padding: '16px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-elevated)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Por Vencer (5 días)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--warning)', marginTop: 4 }}>14</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Listos para cobro</div>
            </div>

            <div style={{ padding: '16px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-elevated)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>En Mora (Gracia 3d)</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--danger)', marginTop: 4 }}>6</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Alerta en torniquete</div>
            </div>

            <div style={{ padding: '16px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--bg-surface-elevated)' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Congeladas</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--info)', marginTop: 4 }}>4</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Periodo pausado</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
