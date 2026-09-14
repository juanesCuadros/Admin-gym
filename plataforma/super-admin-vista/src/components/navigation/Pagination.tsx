import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/actions/Button';

export interface PaginationProps {
  limit: number;
  offset: number;
  totalCount: number;
  onPageChange: (newOffset: number) => void;
  style?: React.CSSProperties;
}

export const Pagination: React.FC<PaginationProps> = ({
  limit,
  offset,
  totalCount,
  onPageChange,
  style,
}) => {
  const from = totalCount === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, totalCount);

  const hasPrev = offset > 0;
  const hasNext = offset + limit < totalCount;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderTop: '1px solid var(--color-border-subtle)',
        fontSize: 'var(--font-size-sm)',
        color: 'var(--color-text-secondary)',
        ...style,
      }}
    >
      <div>
        Mostrando <span style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-primary)' }}>{from}–{to}</span> de{' '}
        <span style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text-primary)' }}>{totalCount}</span> registros
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasPrev}
          onClick={() => onPageChange(Math.max(0, offset - limit))}
          leftIcon={<ChevronLeft size={16} />}
        >
          Anterior
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasNext}
          onClick={() => onPageChange(offset + limit)}
          rightIcon={<ChevronRight size={16} />}
        >
          Siguiente
        </Button>
      </div>
    </div>
  );
};
