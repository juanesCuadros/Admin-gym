import React from 'react';

export interface TabItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  variant?: 'segmented' | 'underline';
  style?: React.CSSProperties;
}

export const Tabs: React.FC<TabsProps> = ({
  tabs,
  activeTab,
  onChange,
  variant = 'segmented',
  style,
}) => {
  if (variant === 'underline') {
    return (
      <div
        role="tablist"
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--color-border)',
          gap: '24px',
          marginBottom: '20px',
          overflowX: 'auto',
          ...style,
        }}
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onChange(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '12px 4px',
                border: 'none',
                background: 'transparent',
                borderBottom: `2px solid ${isActive ? 'var(--color-action)' : 'transparent'}`,
                color: isActive ? 'var(--color-action)' : 'var(--color-text-secondary)',
                fontWeight: isActive ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
                fontSize: 'var(--font-size-md)',
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
                whiteSpace: 'nowrap',
                marginBottom: '-1px',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  style={{
                    backgroundColor: isActive
                      ? 'var(--color-action-light)'
                      : 'var(--color-bg-subtle)',
                    color: isActive ? 'var(--color-action)' : 'var(--color-text-tertiary)',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: 'var(--font-size-xs)',
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  // Segmented Control (Default Apple macOS / iOS style)
  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex',
        padding: '3px',
        backgroundColor: 'var(--color-bg-tertiary)',
        borderRadius: 'var(--radius-md)',
        gap: '2px',
        overflowX: 'auto',
        maxWidth: '100%',
        ...style,
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              padding: '6px 14px',
              borderRadius: 'calc(var(--radius-md) - 2px)',
              border: 'none',
              backgroundColor: isActive ? 'var(--color-bg-card)' : 'transparent',
              color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              fontWeight: isActive ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
              fontSize: 'var(--font-size-sm)',
              boxShadow: isActive ? 'var(--shadow-xs)' : 'none',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                style={{
                  backgroundColor: isActive
                    ? 'var(--color-bg-subtle)'
                    : 'rgba(0, 0, 0, 0.06)',
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: 'var(--font-size-2xs)',
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
