import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  dot?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'neutral',
  dot = false,
  className = '',
  style,
  title,
}) => {
  return (
    <span className={`badge badge-${variant} ${className}`} style={style} title={title}>
      {dot && <span className="badge-dot" />}
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

export const Avatar: React.FC<AvatarProps> = ({ name, src, size = 'md', status }) => {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  return (
    <div className={`avatar avatar-${size}`}>
      {src ? (
        <img src={src} alt={name} className="avatar-img" />
      ) : (
        <div className="avatar-initials" aria-hidden="true">
          {initials || 'U'}
        </div>
      )}
      {status && <span className={`avatar-status ${status}`} />}
    </div>
  );
};
