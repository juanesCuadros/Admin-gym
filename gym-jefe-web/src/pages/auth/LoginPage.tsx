import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dumbbell, ArrowRight, Shield, UserCheck, KeyRound } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme, TENANT_PRESETS } from '../../contexts/TenantThemeContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, loginDemo, isLoading } = useAuth();
  const { tenant, applyPreset } = useTenantTheme();

  const [subdominio, setSubdominio] = useState(tenant.subdominio);
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subdominio || !correo || !password) return;

    const success = await login({ subdominio, correo, password });
    if (success) {
      navigate('/');
    }
  };

  const handleDemo = (role: 'jefe' | 'recepcionista' | 'entrenador') => {
    loginDemo(role, subdominio);
    navigate('/');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        backgroundColor: 'var(--bg-app)',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '440px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: '36px',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Brand Header */}
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 'var(--radius-md)',
              background: 'var(--primary)',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px -2px var(--primary-border)',
              marginBottom: 16,
            }}
          >
            <Dumbbell size={28} />
          </div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            {tenant.nombre}
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: 4 }}>
            Ingresa con tus credenciales de staff del gimnasio
          </p>
        </div>

        {/* Tenant Switcher Pill */}
        <div
          style={{
            marginBottom: 20,
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ color: 'var(--text-secondary)' }}>Sede seleccionada:</span>
          <select
            value={tenant.id}
            onChange={(e) => {
              const selected = TENANT_PRESETS.find((p) => p.id === e.target.value);
              if (selected) {
                applyPreset(selected);
                setSubdominio(selected.subdominio);
              }
            }}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--primary)',
              fontWeight: 700,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {TENANT_PRESETS.map((p) => (
              <option key={p.id} value={p.id} style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <Input
            label="Subdominio del Gimnasio"
            placeholder="ej. smartfit"
            value={subdominio}
            onChange={(e) => setSubdominio(e.target.value.toLowerCase().trim())}
            required
          />

          <Input
            label="Correo Corporativo"
            type="email"
            placeholder="staff@tudominio.com"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            required
          />

          <Input
            label="Contraseña"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          <Button
            type="submit"
            variant="primary"
            isLoading={isLoading}
            style={{ width: '100%', marginTop: 8 }}
            rightIcon={<ArrowRight size={16} />}
          >
            Iniciar Sesión
          </Button>
        </form>

        {/* Demo Fast Access Section */}
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border-color)' }}>
          <div
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              textAlign: 'center',
              letterSpacing: '0.06em',
              marginBottom: 12,
            }}
          >
            Acceso Rápido de Prueba (Demo)
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleDemo('jefe')}
              leftIcon={<Shield size={14} color="var(--primary)" />}
            >
              Jefe
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleDemo('recepcionista')}
              leftIcon={<UserCheck size={14} color="var(--secondary)" />}
            >
              Recepción
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => handleDemo('entrenador')}
              leftIcon={<KeyRound size={14} color="var(--accent)" />}
            >
              Entrenador
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
