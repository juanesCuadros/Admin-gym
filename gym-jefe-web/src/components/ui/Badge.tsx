import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  dot?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  dot = false,
  className = '',
  style,
}) => {
  return (
    <span className={`badge badge-${variant} ${className}`} style={style}>
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: 'currentColor',
            display: 'inline-block',
          }}
        />
      )}
      {children}
    </span>
  );
};

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  status?: 'online' | 'offline' | 'busy';
}

export const Avatar: React.FC<AvatarProps> = ({
  name,
  src,
  size = 'md',
  status,
}) => {
  const sizePx = size === 'sm' ? 28 : size === 'lg' ? 44 : 36;
  const fontSize = size === 'sm' ? '0.75rem' : size === 'lg' ? '1rem' : '0.85rem';

  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      {src ? (
        <img
          src={src}
          alt={name}
          style={{
            width: sizePx,
            height: sizePx,
            borderRadius: 'var(--radius-full)',
            objectFit: 'cover',
            border: '2px solid var(--border-color)',
          }}
        />
      ) : (
        <div
          style={{
            width: sizePx,
            height: sizePx,
            borderRadius: 'var(--radius-full)',
            backgroundColor: 'var(--primary-light)',
            color: 'var(--primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize,
            border: '1px solid var(--primary-border)',
          }}
        >
          {initials || 'U'}
        </div>
      )}
      {status && (
        <span
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: 9,
            height: 9,
            borderRadius: '50%',
            backgroundColor:
              status === 'online' ? 'var(--success)' : status === 'busy' ? 'var(--danger)' : 'var(--text-muted)',
            border: '2px solid var(--bg-surface)',
          }}
        />
      )}
    </div>
  );
};
