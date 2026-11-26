import React from 'react';
import { Award, Edit2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { formatDecimal, plural } from '../../../utils/formato';
import { formatFechaNegocio } from '../../../utils/fechasBogota';
import { etiquetaEstadoMembresia } from '../types';
import type { PerfilDeportistaResponse } from '../../../types/portal.types';

interface TabPerfilMembresiaProps {
  perfil: PerfilDeportistaResponse;
  onAbrirEditarPerfil: () => void;
}

export const TabPerfilMembresia: React.FC<TabPerfilMembresiaProps> = ({
  perfil,
  onAbrirEditarPerfil,
}) => {
  const infoEstado = etiquetaEstadoMembresia(perfil.estado_general);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Cabecera contextual móvil (gimnasio, doc y badge) */}
      <div
        className="portal-mobile-only"
        style={{
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 0 6px',
        }}
      >
        <div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            {perfil.gimnasio_nombre} · {perfil.documento}
          </div>
        </div>
        <Badge variant={infoEstado.variant}>{infoEstado.texto}</Badge>
      </div>

      {/* Tarjetas de Resumen Rápido (2 columnas en móvil) */}
      <div className="portal-kpi-grid">
        <div className="card portal-kpi-card">
          <div>
            <div className="portal-kpi-title" style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Plan Actual
            </div>
            <div className="portal-kpi-val" style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
              {perfil.membresia_actual ? perfil.membresia_actual.plan_nombre : 'Sin plan'}
            </div>
          </div>
          <div className="portal-kpi-sub" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {perfil.membresia_actual
              ? `${plural(perfil.membresia_actual.dias_restantes, 'día', 'días')} restantes`
              : 'Sin membresía'}
          </div>
        </div>

        <div className="card portal-kpi-card">
          <div>
            <div className="portal-kpi-title" style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Asistencias Mes
            </div>
            <div className="portal-kpi-val" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary)', marginTop: 4 }}>
              {plural(perfil.total_asistencias_mes, 'visita', 'visitas')}
            </div>
          </div>
          <div className="portal-kpi-sub" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {perfil.total_asistencias_historico === perfil.total_asistencias_mes
              ? 'Mes de inicio'
              : `${perfil.total_asistencias_historico} históricas`}
          </div>
        </div>

        <div className="card portal-kpi-card">
          <div>
            <div className="portal-kpi-title" style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Último Peso
            </div>
            <div className="portal-kpi-val" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
              {perfil.ultimo_peso_kg ? `${formatDecimal(perfil.ultimo_peso_kg)} kg` : '—'}
            </div>
          </div>
          <div className="portal-kpi-sub" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {perfil.ultimo_grasa_pct ? `Grasa: ${formatDecimal(perfil.ultimo_grasa_pct)}%` : 'Sin registros'}
          </div>
        </div>

        <div className="card portal-kpi-card">
          <div>
            <div className="portal-kpi-title" style={{ fontSize: '0.78rem', fontWeight: 500, color: 'var(--text-secondary)' }}>
              Masa Muscular
            </div>
            <div className="portal-kpi-val" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
              {perfil.ultimo_masa_muscular_kg ? `${formatDecimal(perfil.ultimo_masa_muscular_kg)} kg` : '—'}
            </div>
          </div>
          <div className="portal-kpi-sub" style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
            {perfil.altura_cm ? `Estatura: ${formatDecimal(perfil.altura_cm)} cm` : 'No definida'}
          </div>
        </div>
      </div>

      {/* Ficha de Datos Personales con break-all en email */}
      <div className="card" style={{ padding: '20px 22px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700 }}>Mis Datos Personales</h3>
            <p style={{ margin: '3px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Puedes actualizar tu información de contacto en cualquier momento.
            </p>
          </div>
          <Button variant="primary" size="sm" leftIcon={<Edit2 size={15} />} onClick={onAbrirEditarPerfil}>
            Editar datos
          </Button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Nombre Completo</div>
            <div style={{ fontWeight: 600, fontSize: '0.92rem', marginTop: 2 }}>{perfil.nombre}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Documento de Identidad</div>
            <div style={{ fontWeight: 600, fontSize: '0.92rem', marginTop: 2 }}>{perfil.documento}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Correo Electrónico</div>
            <div
              style={{
                fontWeight: 600,
                fontSize: '0.88rem',
                marginTop: 2,
                wordBreak: 'break-all',
              }}
            >
              {perfil.correo || '—'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Teléfono / Celular</div>
            <div style={{ fontWeight: 600, fontSize: '0.92rem', marginTop: 2 }}>{perfil.telefono || 'No registrado'}</div>
          </div>
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Género</div>
            <div style={{ fontWeight: 600, fontSize: '0.92rem', marginTop: 2 }}>
              {perfil.sexo === 'F' ? 'Femenino' : perfil.sexo === 'M' ? 'Masculino' : 'No especificado'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Estatura</div>
            <div style={{ fontWeight: 600, fontSize: '0.92rem', marginTop: 2 }}>
              {perfil.altura_cm ? `${formatDecimal(perfil.altura_cm)} cm` : 'No registrada'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Fecha de Nacimiento</div>
            <div style={{ fontWeight: 600, fontSize: '0.92rem', marginTop: 2 }}>
              {perfil.fecha_nacimiento ? formatFechaNegocio(perfil.fecha_nacimiento) : 'No registrada'}
            </div>
          </div>
          <div>
            <div style={{ fontSize: '0.76rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Contacto de Emergencia</div>
            <div style={{ marginTop: 2 }}>
              {perfil.acudiente_nombre ? (
                <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{perfil.acudiente_nombre}</span>
              ) : (
                <span style={{ fontStyle: 'italic', fontSize: '0.86rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  No registrado ·{' '}
                  <button
                    type="button"
                    onClick={onAbrirEditarPerfil}
                    style={{
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      color: 'var(--primary)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      fontSize: 'inherit',
                    }}
                  >
                    Agregar
                  </button>
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tarjeta de Estado de Membresía con cálculo de días continuo */}
      <div className="card" style={{ padding: '20px 22px' }}>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Award size={20} style={{ color: 'var(--primary)' }} />
            <div>
              <h3 style={{ margin: 0, fontSize: '1.02rem', fontWeight: 700 }}>Estado de mi Membresía</h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Control de vigencia y días restantes de tu suscripción.
              </p>
            </div>
          </div>
          <Badge variant={infoEstado.variant}>{infoEstado.texto}</Badge>
        </div>

        {perfil.membresia_actual ? (
          (() => {
            const m = perfil.membresia_actual;
            const diasRestantes = Math.max(0, m.dias_restantes);
            let diasTotales = 30;
            if (m.fecha_inicio && m.fecha_vencimiento) {
              const diffMs = new Date(m.fecha_vencimiento).getTime() - new Date(m.fecha_inicio).getTime();
              diasTotales = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
            }
            const pct = Math.max(0, Math.min(100, Math.round((diasRestantes / Math.max(diasTotales, diasRestantes)) * 100)));

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 10,
                  }}
                >
                  <div>
                    <div style={{ fontSize: '1.12rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {m.plan_nombre}
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      Vigente desde el {formatFechaNegocio(m.fecha_inicio)} hasta el{' '}
                      {formatFechaNegocio(m.fecha_vencimiento)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary)' }}>
                      {plural(diasRestantes, 'día restante', 'días restantes')}
                    </span>
                  </div>
                </div>

                {/* Barra de progreso de días */}
                <div>
                  <div
                    style={{
                      height: 10,
                      background: 'var(--bg-surface-elevated)',
                      borderRadius: 999,
                      overflow: 'hidden',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${pct}%`,
                        background: 'var(--primary)',
                        borderRadius: 999,
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.74rem',
                      color: 'var(--text-muted)',
                      marginTop: 6,
                    }}
                  >
                    <span>Inicio: {formatFechaNegocio(m.fecha_inicio)}</span>
                    <span>{pct}% del periodo</span>
                    <span>Vence: {formatFechaNegocio(m.fecha_vencimiento)}</span>
                  </div>
                </div>
              </div>
            );
          })()
        ) : (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            Actualmente no cuentas con una membresía activa. Visita la recepción del gimnasio para adquirir tu plan.
          </div>
        )}
      </div>
    </div>
  );
};

