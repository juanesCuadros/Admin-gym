import React, { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({
  title,
  action,
  children,
  className = '',
  style,
}) => {
  return (
    <div className={`card ${className}`} style={style}>
      {(title || action) && (
        <div className="card-header">
          {title && <h3 className="card-title">{title}</h3>}
          {action && <div>{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
};

export interface KpiCardProps {
  label: string;
  value: string | number;
  icon: ReactNode;
  subtext?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  icon,
  subtext,
  color,
}) => {
  return (
    <div className="kpi-card" style={color ? { borderTopColor: color } : undefined}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <div className="kpi-icon-wrap" style={color ? { color, backgroundColor: `${color}18` } : undefined}>
          {icon}
        </div>
      </div>
      <div className="kpi-value">{value}</div>
      {subtext && <div className="kpi-subtext">{subtext}</div>}
    </div>
  );
};
