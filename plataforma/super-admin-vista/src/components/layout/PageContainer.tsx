import React from 'react';

export interface PageContainerProps {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export const PageContainer: React.FC<PageContainerProps> = ({
  children,
  style,
  className = '',
}) => {
  return (
    <div
      className={`container-responsive ${className}`}
      style={{
        paddingTop: 'var(--space-6)',
        paddingBottom: 'var(--space-12)',
        ...style,
      }}
    >
      {children}
    </div>
  );
};
