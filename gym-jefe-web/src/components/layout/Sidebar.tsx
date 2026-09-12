import React from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ShieldCheck,
  CreditCard,
  Users,
  Award,
  Dumbbell,
  Calendar,
  Tv,
  Package,
  UserCheck,
  BarChart3,
  Settings,
  Dumbbell as GymLogoIcon,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useTenantTheme } from '../../contexts/TenantThemeContext';
import { Badge } from '../ui/Badge';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onClose }) => {
  const { hasPermission, isJefe } = useAuth();
  const { tenant } = useTenantTheme();

  // Navigation definition with permissions requirements
  const navItems = [
    {
      to: '/',
      label: 'Dashboard',
      icon: LayoutDashboard,
      show: true,
    },
    {
      to: '/control-ingreso',
      label: 'Control de Ingreso',
      icon: ShieldCheck,
      show: hasPermission('control_ingreso', 'leer'),
    },
    {
      to: '/caja',
      label: 'Caja y Turnos',
      icon: CreditCard,
      show: hasPermission('caja', 'leer'),
    },
    {
      to: '/deportistas',
      label: 'Deportistas',
      icon: Users,
      show: hasPermission('deportistas', 'leer'),
    },
    {
      to: '/membresias',
      label: 'Membresías y Planes',
      icon: Award,
      show: hasPermission('membresias', 'leer'),
    },
    {
      to: '/entrenamiento',
      label: 'Entrenamiento',
      icon: Dumbbell,
      show: hasPermission('entrenamiento', 'leer'),
    },
    {
      to: '/clases',
      label: 'Clases y Reservas',
      icon: Calendar,
      show: hasPermission('clases', 'leer'),
    },
    {
      to: '/pantalla-tv',
      label: 'Pantalla Recepción (TV)',
      icon: Tv,
      show: true,
    },
    {
      to: '/inventario',
      label: 'Inventario',
      icon: Package,
      show: isJefe || hasPermission('caja', 'leer'),
    },
    {
      to: '/personal',
      label: 'Personal y Permisos',
      icon: UserCheck,
      show: isJefe,
    },
    {
      to: '/reportes',
      label: 'Reportes y Métricas',
      icon: BarChart3,
      show: isJefe,
    },
    {
      to: '/configuracion',
      label: 'Configuración MyGymOS',
      icon: Settings,
      show: isJefe,
    },
  ];

  return (
    <>
      {isOpen && <div className="sidebar-overlay" onClick={onClose} />}
      <aside className={`app-sidebar ${isOpen ? 'open' : ''}`}>
        {/* Brand Header */}
        <div
          style={{
            height: 72,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '0 20px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 'var(--radius-sm)',
              background: 'var(--primary)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px -1px var(--primary-border)',
              flexShrink: 0,
            }}
          >
            <GymLogoIcon size={22} />
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div
              style={{
                fontSize: '1.05rem',
                fontWeight: 800,
                color: 'var(--text-primary)',
                letterSpacing: '-0.02em',
                whiteSpace: 'nowrap',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
              }}
            >
              {tenant.nombre}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              {tenant.subdominio}.gymos.co
            </div>
          </div>
        </div>

        {/* Navigation List */}
        <div style={{ flex: 1, padding: '16px 12px', overflowY: 'auto' }}>
          <div
            style={{
              fontSize: '0.725rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              color: 'var(--text-muted)',
              letterSpacing: '0.08em',
              padding: '0 12px 10px 12px',
            }}
          >
            Módulos Operativos
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {navItems
              .filter((item) => item.show)
              .map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => {
                      if (window.innerWidth <= 1024) onClose();
                    }}
                    style={({ isActive }) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.9rem',
                      fontWeight: isActive ? 700 : 500,
                      color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                      backgroundColor: isActive ? 'var(--primary-light)' : 'transparent',
                      textDecoration: 'none',
                      transition: 'all var(--transition-fast)',
                    })}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
          </nav>
        </div>

        {/* Multi-Tenant SaaS Footer Info */}
        <div
          style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-sidebar)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Tenant SaaS Activo</span>
            <Badge variant="primary" dot>
              v1.0.0
            </Badge>
          </div>
          <div>RLS Aislado · Multi-Tenant</div>
        </div>
      </aside>
    </>
  );
};
