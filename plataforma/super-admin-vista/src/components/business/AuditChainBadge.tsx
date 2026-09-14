import React from 'react';
import { ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react';
import { AuditChainVerification } from '@/types/audit.types';
import { Button } from '@/components/actions/Button';

export interface AuditChainBadgeProps {
  verification: AuditChainVerification | null;
  isVerifying?: boolean;
  onReverify?: () => void;
  style?: React.CSSProperties;
}

export const AuditChainBadge: React.FC<AuditChainBadgeProps> = ({
  verification,
  isVerifying = false,
  onReverify,
  style,
}) => {
  if (!verification) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          borderRadius: 'var(--radius-full)',
          backgroundColor: 'var(--color-bg-subtle)',
          border: '1px solid var(--color-border)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-secondary)',
          ...style,
        }}
      >
        <RefreshCw size={14} className="spinner" />
        <span>Verificando cadena criptográfica…</span>
      </div>
    );
  }

  const isHealthy = verification.cadena_integra;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '12px',
        padding: '6px 14px',
        borderRadius: 'var(--radius-full)',
        backgroundColor: isHealthy ? 'var(--color-success-light)' : 'var(--color-error-light)',
        border: `1px solid ${isHealthy ? 'rgba(52, 199, 89, 0.35)' : 'rgba(255, 59, 48, 0.35)'}`,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        {isHealthy ? (
          <ShieldCheck size={16} color="var(--color-success)" strokeWidth={2.5} />
        ) : (
          <ShieldAlert size={16} color="var(--color-error)" strokeWidth={2.5} />
        )}
        <span
          style={{
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--font-weight-semibold)',
            color: isHealthy ? 'var(--color-success)' : 'var(--color-error)',
          }}
        >
          {isHealthy
            ? `Cadena SHA-256 Íntegra (${verification.total_registros_verificados} bloques)`
            : `¡Corrupción detectada en bloque #${verification.primer_registro_corrupto_id}!`}
        </span>
      </div>

      {onReverify && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onReverify}
          isLoading={isVerifying}
          style={{
            padding: '2px 6px',
            minHeight: '24px',
            fontSize: 'var(--font-size-2xs)',
            color: isHealthy ? 'var(--color-success)' : 'var(--color-error)',
          }}
        >
          Verificar Ahora
        </Button>
      )}
    </div>
  );
};
