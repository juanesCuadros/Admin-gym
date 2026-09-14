import React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  'aria-label': string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  'aria-label': ariaLabel,
  size = 'md',
  variant = 'ghost',
  disabled,
  style,
  className = '',
  ...props
}) => {
  const getSize = () => {
    switch (size) {
      case 'sm':
        return { width: '32px', height: '32px', minWidth: '32px', minHeight: '32px' };
      case 'lg':
        return { width: '48px', height: '48px', minWidth: '48px', minHeight: '48px' };
      case 'md':
      default:
        // Apple HIG recommends ≥44x44 for touch accessibility
        return { width: '40px', height: '40px', minWidth: '40px', minHeight: '40px' };
    }
  };

  const getVariant = (): React.CSSProperties => {
    switch (variant) {
      case 'primary':
        return {
          backgroundColor: 'var(--color-action)',
          color: '#FFFFFF',
          border: 'none',
        };
      case 'secondary':
        return {
          backgroundColor: 'var(--color-bg-card)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
        };
      case 'destructive':
        return {
          backgroundColor: 'var(--color-error-light)',
          color: 'var(--color-error)',
          border: 'none',
        };
      case 'ghost':
      default:
        return {
          backgroundColor: 'transparent',
          color: 'var(--color-text-secondary)',
          border: 'none',
        };
    }
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 'var(--radius-sm)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        transition: 'all var(--transition-fast)',
        ...getSize(),
        ...getVariant(),
        ...style,
      }}
      className={`icon-btn-apple ${className}`}
      {...props}
    >
      {icon}
    </button>
  );
};
