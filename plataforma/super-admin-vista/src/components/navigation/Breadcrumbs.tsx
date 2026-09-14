import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  style?: React.CSSProperties;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items, style }) => {
  return (
    <nav aria-label="Migas de pan" style={{ display: 'flex', alignItems: 'center', gap: '6px', ...style }}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;

        return (
          <React.Fragment key={index}>
            {index > 0 && (
              <ChevronRight size={14} color="var(--color-text-tertiary)" style={{ flexShrink: 0 }} />
            )}

            {isLast || !item.href ? (
              <span
                style={{
                  fontSize: 'var(--font-size-sm)',
                  fontWeight: isLast ? 'var(--font-weight-medium)' : 'var(--font-weight-regular)',
                  color: isLast ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                }}
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            ) : (
              <Link
                to={item.href}
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--color-text-secondary)',
                  transition: 'color var(--transition-fast)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--color-action)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--color-text-secondary)';
                }}
              >
                {item.label}
              </Link>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
