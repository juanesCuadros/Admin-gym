import React from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  breadcrumbs,
  actions,
  style,
}) => {
  return (
    <header
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        marginBottom: 'var(--space-6)',
        ...style,
      }}
    >
      {breadcrumbs && <div style={{ marginBottom: '4px' }}>{breadcrumbs}</div>}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 'var(--font-size-3xl)',
              fontWeight: 'var(--font-weight-bold)',
              letterSpacing: '-0.025em',
              color: 'var(--color-text-primary)',
              lineHeight: 1.2,
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p
              style={{
                fontSize: 'var(--font-size-md)',
                color: 'var(--color-text-secondary)',
                marginTop: '4px',
              }}
            >
              {subtitle}
            </p>
          )}
        </div>

        {actions && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            {actions}
          </div>
        )}
      </div>
    </header>
  );
};
