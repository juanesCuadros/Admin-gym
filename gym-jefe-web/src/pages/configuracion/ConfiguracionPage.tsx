import React, { useState } from 'react';
import { Settings, Palette, Tv, ShieldAlert, Save, RefreshCw, Check } from 'lucide-react';
import { useTenantTheme, TENANT_PRESETS } from '../../contexts/TenantThemeContext';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';

export const ConfiguracionPage: React.FC = () => {
  const { tenant, updateBranding, applyPreset } = useTenantTheme();
  const { showToast } = useToast();

  const [nombre, setNombre] = useState(tenant.nombre);
  const [primaryColor, setPrimaryColor] = useState(tenant.primary_color || '#4f46e5');
  const [secondaryColor, setSecondaryColor] = useState(tenant.secondary_color || '#06b6d4');
  const [accentColor, setAccentColor] = useState(tenant.accent_color || '#f59e0b');

  const [diasGracia, setDiasGracia] = useState(tenant.dias_gracia_mora);
  const [diasUmbral, setDiasUmbral] = useState(tenant.dias_umbral_por_vencer);
  const [topeCongelamiento, setTopeCongelamiento] = useState(tenant.tope_dias_congelamiento);

  const handleApplyBranding = (e: React.FormEvent) => {
    e.preventDefault();
    updateBranding({
      nombre,
      primary: primaryColor,
      secondary: secondaryColor,
      accent: accentColor,
    });
    showToast('success', 'Branding Actualizado', 'Los nuevos colores y nombre se aplicaron a toda la plataforma');
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Configuración MyGymOS y Branding</h1>
          <p className="page-subtitle">
            Personalización visual, colores corporativos, políticas de acceso y configuración de sede
          </p>
        </div>

        <Button variant="primary" leftIcon={<Save size={16} />} onClick={handleApplyBranding}>
          Guardar Cambios
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 24 }}>
        {/* Branding & Visual Tokens Card */}
        <Card title="Identidad Visual y Branding">
          <form onSubmit={handleApplyBranding}>
            <Input
              label="Nombre Comercial del Gimnasio"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              required
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, margin: '16px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Color Principal (Primary)</div>
                  <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                    Botones principales, acentos y navegación activa
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={primaryColor}
                    onChange={(e) => setPrimaryColor(e.target.value)}
                    style={{ width: 36, height: 36, border: 'none', borderRadius: 'var(--radius-xs)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>{primaryColor}</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Color Secundario</div>
                  <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                    Badges y elementos complementarios
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={secondaryColor}
                    onChange={(e) => setSecondaryColor(e.target.value)}
                    style={{ width: 36, height: 36, border: 'none', borderRadius: 'var(--radius-xs)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>{secondaryColor}</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Color de Acento</div>
                  <div style={{ fontSize: '0.775rem', color: 'var(--text-muted)' }}>
                    Alertas visuales y llamados de atención
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="color"
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    style={{ width: 36, height: 36, border: 'none', borderRadius: 'var(--radius-xs)', cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)' }}>{accentColor}</span>
                </div>
              </div>
            </div>

            <Button type="submit" variant="primary" style={{ width: '100%' }}>
              Aplicar Colores en Vivo
            </Button>
          </form>

          {/* Quick Preset Cards */}
          <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: 10, color: 'var(--text-secondary)' }}>
              Paletas Predefinidas:
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {TENANT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    applyPreset(preset);
                    setNombre(preset.nombre);
                    setPrimaryColor(preset.primary);
                    setSecondaryColor(preset.secondary);
                    setAccentColor(preset.accent);
                  }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    color: 'var(--text-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    fontSize: '0.8rem',
                    textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      backgroundColor: preset.primary,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {preset.nombre}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Business Rules & Policies Card */}
        <Card title="Políticas Operativas de Acceso">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Input
              label="Días de Gracia en Mora (Torniquete Alerta)"
              type="number"
              value={diasGracia}
              onChange={(e) => setDiasGracia(Number(e.target.value))}
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: -8 }}>
              Días en los cuales un miembro con pago vencido recibe aviso sonoro/visual en el torniquete pero se le permite ingresar.
            </p>

            <Input
              label="Umbral de Alerta 'Por Vencer' (Días)"
              type="number"
              value={diasUmbral}
              onChange={(e) => setDiasUmbral(Number(e.target.value))}
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: -8 }}>
              Días previos al vencimiento para notificar al recepcionista y al deportista.
            </p>

            <Input
              label="Tope Máximo de Días de Congelamiento"
              type="number"
              value={topeCongelamiento}
              onChange={(e) => setTopeCongelamiento(Number(e.target.value))}
            />
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: -8 }}>
              Límite acumulado de congelamiento permitido por año para evitar abuso de pausas.
            </p>

            <div
              style={{
                marginTop: 10,
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--bg-surface-elevated)',
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
              }}
            >
              <div>Subdominio configurado: <strong>{tenant.subdominio}</strong></div>
              <div>Zona Horaria: <strong>{tenant.zona_horaria}</strong></div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};
