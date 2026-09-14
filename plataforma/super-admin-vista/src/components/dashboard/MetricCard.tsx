import React from 'react';

export interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  iconBg?: string;
  iconColor?: string;
  variant?: 'default' | 'success' | 'warning' | 'error';
  style?: React.CSSProperties;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  iconBg = 'var(--color-action-light)',
  iconColor = 'var(--color-action)',
  variant = 'default',
  style,
}) => {
  const getBorder = () => {
    switch (variant) {
      case 'warning':
        return '1px solid var(--color-warning-light)';
      case 'error':
        return '1px solid var(--color-error-light)';
      case 'success':
        return '1px solid var(--color-success-light)';
      default:
        return '1px solid var(--color-border)';
    }
  };

  return (
    <div
      style={{
        backgroundColor: 'var(--color-bg-card)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px',
        border: getBorder(),
        boxShadow: 'var(--shadow-xs)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '130px',
        transition: 'all var(--transition-fast)',
        ...style,
      }}
      className="metric-card-hover"
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-medium)' }}>
          {title}
        </div>
        <div
          style={{
            width: '36px',
            height: '36px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: iconBg,
            color: iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      </div>

      <div style={{ marginTop: '12px' }}>
        <div
          style={{
            fontSize: 'var(--font-size-3xl)',
            fontWeight: 'var(--font-weight-bold)',
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
          }}
          className="font-mono"
        >
          {value}
        </div>
        {subtitle && (
          <div
            style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-tertiary)',
              marginTop: '4px',
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
};
