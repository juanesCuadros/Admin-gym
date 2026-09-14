import React from 'react';

export interface MetricGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  style?: React.CSSProperties;
}

export const MetricGrid: React.FC<MetricGridProps> = ({
  children,
  columns = 4,
  style,
}) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`,
        gap: '16px',
        marginBottom: '24px',
        width: '100%',
        ...style,
      }}
    >
      {children}
    </div>
  );
};
