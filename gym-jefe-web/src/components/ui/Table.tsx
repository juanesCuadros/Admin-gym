import React, { ReactNode } from 'react';
import { Loader2, Inbox } from 'lucide-react';
import { Button } from './Button';

export interface Column<T> {
  header: string;
  accessor?: keyof T | ((item: T) => ReactNode);
  render?: (item: T) => ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading?: boolean;
  emptyMessage?: string;
  keyExtractor: (item: T) => string | number;
  pagination?: {
    currentPage: number;
    totalPages: number;
    onPageChange: (page: number) => void;
  };
}

export function Table<T>({
  columns,
  data,
  isLoading = false,
  emptyMessage = 'No se encontraron registros',
  keyExtractor,
  pagination,
}: TableProps<T>) {
  return (
    <div className="table-wrapper">
      <div className="table-responsive">
        <table className="table-base">
          <thead>
            <tr>
              {columns.map((col, idx) => (
                <th
                  key={idx}
                  style={{
                    width: col.width,
                    textAlign: col.align || 'left',
                  }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '48px 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                    <Loader2 size={28} className="animate-spin" color="var(--primary)" />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Cargando datos...</span>
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '48px 0' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <Inbox size={32} color="var(--text-muted)" />
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((item) => (
                <tr key={keyExtractor(item)}>
                  {columns.map((col, colIdx) => {
                    let content: ReactNode = null;
                    if (col.render) {
                      content = col.render(item);
                    } else if (typeof col.accessor === 'function') {
                      content = col.accessor(item);
                    } else if (col.accessor) {
                      content = item[col.accessor] as unknown as ReactNode;
                    }

                    return (
                      <td key={colIdx} style={{ textAlign: col.align || 'left' }}>
                        {content}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.875rem',
            color: 'var(--text-secondary)',
          }}
        >
          <span>
            Página {pagination.currentPage} de {pagination.totalPages}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.currentPage <= 1}
              onClick={() => pagination.onPageChange(pagination.currentPage - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.currentPage >= pagination.totalPages}
              onClick={() => pagination.onPageChange(pagination.currentPage + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionText,
  onAction,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '56px 20px',
        textAlign: 'center',
        background: 'var(--bg-surface)',
        border: '1px dashed var(--border-color)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
        {icon || <Inbox size={42} />}
      </div>
      <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
        {title}
      </h4>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: 420, marginBottom: 20 }}>
        {description}
      </p>
      {actionText && onAction && (
        <Button variant="primary" onClick={onAction}>
          {actionText}
        </Button>
      )}
    </div>
  );
};

export const LoadingSpinner: React.FC<{ size?: number; label?: string }> = ({
  size = 28,
  label,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 }}>
      <Loader2 size={size} className="animate-spin" color="var(--primary)" />
      {label && <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{label}</span>}
    </div>
  );
};
