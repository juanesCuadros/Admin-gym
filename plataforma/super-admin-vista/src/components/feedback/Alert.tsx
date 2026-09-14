import React from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

export type AlertType = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  type?: AlertType;
  title?: string;
  message: React.ReactNode;
  onClose?: () => void;
  style?: React.CSSProperties;
}

export const Alert: React.FC<AlertProps> = ({
  type = 'info',
  title,
  message,
  onClose,
  style,
}) => {
  const getConfig = () => {
    switch (type) {
      case 'success':
        return {
          bg: 'var(--color-success-light)',
          border: 'rgba(52, 199, 89, 0.3)',
          color: 'var(--color-success)',
          icon: <CheckCircle2 size={18} />,
        };
      case 'warning':
        return {
          bg: 'var(--color-warning-light)',
          border: 'rgba(255, 149, 0, 0.3)',
          color: 'var(--color-warning)',
          icon: <AlertTriangle size={18} />,
        };
      case 'error':
        return {
          bg: 'var(--color-error-light)',
          border: 'rgba(255, 59, 48, 0.3)',
          color: 'var(--color-error)',
          icon: <AlertCircle size={18} />,
        };
      case 'info':
      default:
        return {
          bg: 'var(--color-action-light)',
          border: 'rgba(0, 122, 255, 0.3)',
          color: 'var(--color-action)',
          icon: <Info size={18} />,
        };
    }
  };

  const config = getConfig();

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '12px 16px',
        borderRadius: 'var(--radius-md)',
        backgroundColor: config.bg,
        border: `1px solid ${config.border}`,
        marginBottom: '16px',
        ...style,
      }}
    >
      <div style={{ color: config.color, marginTop: '2px', flexShrink: 0 }}>
        {config.icon}
      </div>

      <div style={{ flex: 1 }}>
        {title && (
          <div
            style={{
              fontWeight: 'var(--font-weight-semibold)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-primary)',
              marginBottom: '2px',
            }}
          >
            {title}
          </div>
        )}
        <div
          style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-text-primary)',
            lineHeight: 1.45,
          }}
        >
          {message}
        </div>
      </div>

      {onClose && (
        <button
          onClick={onClose}
          aria-label="Cerrar alerta"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
          }}
        >
          <X size={16} />
        </button>
      )}
    </div>
  );
};
