import React, { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  /** Texto de apoyo bajo el título (opcional). */
  subtitle?: string;
  /** Icono decorativo arriba a la derecha (se ignora si hay `action`). */
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const Card: React.FC<CardProps> = ({ title, subtitle, icon, action, children, className = '', style }) => {
  const derecha = action ?? (icon ? <span className="card-header-icon">{icon}</span> : null);
  return (
    <div className={`card ${className}`} style={style}>
      {(title || derecha) && (
        <div className="card-header">
          <div className="card-header-text">
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {derecha && <div className="card-action">{derecha}</div>}
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
  /**
   * @deprecated Se conserva para no romper las páginas que ya lo pasan (Caja, etc.),
   * pero ya no cambia el color: todas las tarjetas usan la misma paleta neutra.
   */
  color?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({ label, value, icon, subtext }) => {
  const esTexto = typeof value === 'string' && /[a-zA-ZáéíóúÁÉÍÓÚñÑ]/.test(value) && !/\d/.test(value);
  return (
    <div className="kpi-card">
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon-wrap">{icon}</span>
      </div>
      <div className={`kpi-value ${esTexto ? 'texto' : ''}`}>{value}</div>
      {subtext && <div className="kpi-subtext">{subtext}</div>}
    </div>
  );
};
