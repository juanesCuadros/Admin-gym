import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dumbbell, ArrowRight, Shield, UserCheck, KeyRound, Building2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme, TENANT_PRESETS } from '../../contexts/TenantThemeContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { login, loginDemo, isLoading } = useAuth();
  const { tenant, applyPreset } = useTenantTheme();

  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correo || !password) return;

    // El subdominio se inyecta automáticamente desde el tenant de la sede actual
    const success = await login({
      subdominio: tenant.subdominio,
      correo: correo.trim(),
      password,
    });

    if (success) {
      navigate('/');
    }
  };

  // Atajos opcionales para pruebas rápidas de interfaz según el rol
  const handleDemo = (role: 'jefe' | 'recepcionista' | 'entrenador') => {
    loginDemo(role, tenant.subdominio);
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
          maxWidth: '430px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          padding: '36px',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        {/* Encabezado con Identidad Institucional del Gimnasio */}
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
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 4,
              fontSize: '0.8rem',
              color: 'var(--primary)',
              fontWeight: 600,
            }}
          >
            <Building2 size={14} />
            <span>{tenant.subdominio}.gymos.co</span>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 8 }}>
            Ingresa tu correo y contraseña para acceder al sistema
          </p>
        </div>

        {/* Selector de Sede para entorno de pruebas / localhost */}
        <div
          style={{
            marginBottom: 20,
            padding: '8px 12px',
            borderRadius: 'var(--radius-sm)',
            backgroundColor: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-color)',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ color: 'var(--text-muted)' }}>Sede (Multi-tenant):</span>
          <select
            value={tenant.id}
            onChange={(e) => {
              const selected = TENANT_PRESETS.find((p) => p.id === e.target.value);
              if (selected) {
                applyPreset(selected);
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

        {/* Formulario de Login Limpio: Solo Correo y Contraseña */}
        <form onSubmit={handleSubmit}>
          <Input
            label="Correo Electrónico"
            type="email"
            placeholder="usuario@gimnasio.com"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            autoFocus
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

        {/* Atajos de Demostración para Evaluar Vistas por Rol */}
        <div style={{ marginTop: 28, paddingTop: 20, borderTop: '1px solid var(--border-color)' }}>
          <div
            style={{
              fontSize: '0.725rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              textAlign: 'center',
              letterSpacing: '0.06em',
              marginBottom: 10,
            }}
          >
            Acceso Rápido Demo (Prueba de Roles)
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
