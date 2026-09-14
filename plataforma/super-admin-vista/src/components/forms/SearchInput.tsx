import React from 'react';
import { Search, X } from 'lucide-react';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onClear?: () => void;
  style?: React.CSSProperties;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Buscar…',
  onClear,
  style,
}) => {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        maxWidth: '320px',
        backgroundColor: 'var(--color-bg-card)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border-strong)',
        overflow: 'hidden',
        transition: 'all var(--transition-fast)',
        ...style,
      }}
    >
      <div
        style={{
          paddingLeft: '12px',
          display: 'flex',
          alignItems: 'center',
          color: 'var(--color-text-tertiary)',
        }}
      >
        <Search size={16} />
      </div>

      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          height: '38px',
          padding: '0 8px',
          paddingRight: value ? '32px' : '12px',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-primary)',
        }}
      />

      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('');
            if (onClear) onClear();
          }}
          aria-label="Limpiar búsqueda"
          style={{
            position: 'absolute',
            right: '8px',
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
