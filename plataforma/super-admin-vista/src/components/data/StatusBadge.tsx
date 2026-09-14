import React from 'react';
import {
  CheckCircle2,
  Clock,
  PauseCircle,
  XCircle,
  AlertTriangle,
  ShieldCheck,
  User,
  Info,
} from 'lucide-react';

export type BadgeStatusType =
  | 'activo'
  | 'prueba'
  | 'suspendido'
  | 'cancelado'
  | 'anulado'
  | 'vigente'
  | 'vencido'
  | 'por_vencer'
  | 'superadmin'
  | 'operador'
  | string;

export interface StatusBadgeProps {
  status: BadgeStatusType;
  label?: string;
  size?: 'sm' | 'md';
  style?: React.CSSProperties;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  label,
  size = 'md',
  style,
}) => {
  const normalized = (status || '').toLowerCase();

  const getStatusConfig = () => {
    switch (normalized) {
      case 'activo':
      case 'active':
      case 'vigente':
        return {
          bg: 'var(--color-success-light)',
          color: 'var(--color-success)',
          icon: <CheckCircle2 size={13} />,
          text: label || 'Activo',
        };
      case 'prueba':
      case 'trial':
        return {
          bg: 'var(--color-warning-light)',
          color: 'var(--color-warning)',
          icon: <Clock size={13} />,
          text: label || 'En Prueba',
        };
      case 'por_vencer':
        return {
          bg: 'var(--color-warning-light)',
          color: 'var(--color-warning)',
          icon: <AlertTriangle size={13} />,
          text: label || 'Por Vencer',
        };
      case 'suspendido':
      case 'suspended':
        return {
          bg: 'rgba(255, 149, 0, 0.15)',
          color: '#D97E00',
          icon: <PauseCircle size={13} />,
          text: label || 'Suspendido',
        };
      case 'vencido':
      case 'anulado':
      case 'voided':
        return {
          bg: 'var(--color-error-light)',
          color: 'var(--color-error)',
          icon: <XCircle size={13} />,
          text: label || (normalized === 'anulado' ? 'Anulado' : 'Vencido'),
        };
      case 'cancelado':
      case 'cancelled':
        return {
          bg: 'var(--color-bg-subtle)',
          color: 'var(--color-text-tertiary)',
          icon: <XCircle size={13} />,
          text: label || 'Cancelado',
        };
      case 'superadmin':
        return {
          bg: 'var(--color-purple-light)',
          color: 'var(--color-purple)',
          icon: <ShieldCheck size={13} />,
          text: label || 'Super Admin',
        };
      case 'operador':
        return {
          bg: 'var(--color-indigo-light)',
          color: 'var(--color-indigo)',
          icon: <User size={13} />,
          text: label || 'Operador',
        };
      default:
        return {
          bg: 'var(--color-bg-subtle)',
          color: 'var(--color-text-secondary)',
          icon: <Info size={13} />,
          text: label || status,
        };
    }
  };

  const config = getStatusConfig();
  const isSmall = size === 'sm';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: isSmall ? '2px 8px' : '4px 10px',
        borderRadius: 'var(--radius-full)',
        backgroundColor: config.bg,
        color: config.color,
        fontSize: isSmall ? 'var(--font-size-2xs)' : 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-semibold)',
        lineHeight: 1,
        whiteSpace: 'nowrap',
        userSelect: 'none',
        ...style,
      }}
    >
      {config.icon}
      <span>{config.text}</span>
    </span>
  );
};
