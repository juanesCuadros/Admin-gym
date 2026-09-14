import React from 'react';

export interface FilterBarProps {
  children: React.ReactNode;
  actions?: React.ReactNode;
  style?: React.CSSProperties;
}

export const FilterBar: React.FC<FilterBarProps> = ({ children, actions, style }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '12px 16px',
        backgroundColor: 'var(--color-bg-card)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-xs)',
        marginBottom: '16px',
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '12px',
          flex: 1,
        }}
      >
        {children}
      </div>

      {actions && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {actions}
        </div>
      )}
    </div>
  );
};
