import React, { useState } from 'react';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { FilterBar } from '@/components/forms/FilterBar';
import { SearchInput } from '@/components/forms/SearchInput';
import { Select } from '@/components/forms/Select';
import { DataTable, ColumnDef } from '@/components/data/DataTable';
import { Pagination } from '@/components/navigation/Pagination';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/actions/Button';
import { AuditChainBadge } from '@/components/business/AuditChainBadge';
import { useAudit } from '@/hooks/useAudit';
import { AuditLog } from '@/types/audit.types';
import { ShieldCheck, Eye, Hash, Clock, User, FileText } from 'lucide-react';

export const AuditPage: React.FC = () => {
  const {
    logs,
    verification,
    isLoading,
    isVerifying,
    error,
    accion,
    setAccion,
    limit,
    offset,
    setOffset,
    refetch,
    verifyChain,
  } = useAudit();

  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const columns: ColumnDef<AuditLog>[] = [
    {
      id: 'id',
      header: 'Bloque #',
      width: '90px',
      render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-secondary)' }}>
          #{row.id}
        </span>
      ),
    },
    {
      id: 'fecha',
      header: 'Timestamp (UTC)',
      render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-xs)' }}>
          {new Date(row.created_at).toLocaleString('es-CO')}
        </span>
      ),
    },
    {
      id: 'actor',
      header: 'Actor Responsable',
      render: (row) => (
        <div>
          <div style={{ fontWeight: 'var(--font-weight-medium)', fontSize: 'var(--font-size-sm)' }}>
            {row.actor_nombre}
          </div>
          {row.impersonando && (
            <span style={{ fontSize: 'var(--font-size-2xs)', color: 'var(--color-warning)' }}>
              (Soporte Impersonado)
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'accion',
      header: 'Acción Ejecutada',
      render: (row) => (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--font-size-xs)',
            padding: '3px 8px',
            borderRadius: 'var(--radius-xs)',
            backgroundColor: 'var(--color-bg-subtle)',
            border: '1px solid var(--color-border)',
            fontWeight: 'var(--font-weight-medium)',
          }}
        >
          {row.accion}
        </span>
      ),
    },
    {
      id: 'entidad',
      header: 'Entidad / ID',
      render: (row) => (
        <div style={{ fontSize: 'var(--font-size-xs)' }}>
          <span style={{ fontWeight: 'var(--font-weight-semibold)' }}>{row.entidad}</span>
          {row.entidad_id && (
            <span style={{ color: 'var(--color-text-tertiary)', marginLeft: '4px', fontFamily: 'var(--font-mono)' }}>
              ({row.entidad_id.substring(0, 8)}…)
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'hash_actual',
      header: 'Hash Criptográfico SHA-256',
      render: (row) => (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-2xs)', color: 'var(--color-text-tertiary)' }}>
          <span>{row.hash_actual.substring(0, 12)}…{row.hash_actual.substring(row.hash_actual.length - 8)}</span>
        </div>
      ),
    },
    {
      id: 'acciones',
      header: '',
      align: 'right',
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedLog(row)}
          leftIcon={<Eye size={14} />}
        >
          Detalle
        </Button>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Auditoría Inmutable Criptográfica (RNF-03)"
        subtitle="Registro append-only inalterable de todas las operaciones de escritura encadenadas mediante hashes SHA-256."
        actions={
          <AuditChainBadge
            verification={verification}
            isVerifying={isVerifying}
            onReverify={verifyChain}
          />
        }
      />

      {/* Filter Bar */}
      <FilterBar>
        <div style={{ width: '220px' }}>
          <Select
            value={accion}
            onChange={(e) => setAccion(e.target.value)}
            options={[
              { value: '', label: 'Todas las acciones' },
              { value: 'CREAR_GIMNASIO', label: 'CREAR_GIMNASIO' },
              { value: 'CAMBIO_ESTADO_GIMNASIO', label: 'CAMBIO_ESTADO_GIMNASIO' },
              { value: 'CANCELAR_GIMNASIO', label: 'CANCELAR_GIMNASIO' },
              { value: 'REGISTRAR_PAGO', label: 'REGISTRAR_PAGO' },
              { value: 'ANULAR_PAGO', label: 'ANULAR_PAGO' },
              { value: 'ACTUALIZAR_PRECIO_SUSCRIPCION', label: 'ACTUALIZAR_PRECIO_SUSCRIPCION' },
              { value: 'REGENERAR_CREDENCIALES', label: 'REGENERAR_CREDENCIALES' },
              { value: 'CREAR_EJERCICIO', label: 'CREAR_EJERCICIO' },
              { value: 'IMPORTAR_DATASET_EJERCICIOS', label: 'IMPORTAR_DATASET_EJERCICIOS' },
            ]}
          />
        </div>
      </FilterBar>

      {/* Audit DataTable */}
      <DataTable
        columns={columns}
        data={logs}
        keyExtractor={(item) => item.id}
        isLoading={isLoading}
        error={error}
        onRetry={refetch}
        onRowClick={(row) => setSelectedLog(row)}
        emptyTitle="Sin registros de auditoría"
        emptyDescription="Las acciones realizadas por los operadores quedarán registradas de inmediato."
      />

      {/* Pagination */}
      {logs.length > 0 && (
        <Pagination
          limit={limit}
          offset={offset}
          totalCount={logs.length >= limit ? offset + limit + 1 : offset + logs.length}
          onPageChange={setOffset}
        />
      )}

      {/* Detail JSON Modal */}
      {selectedLog && (
        <Modal
          isOpen={!!selectedLog}
          onClose={() => setSelectedLog(null)}
          title={`Bloque de Auditoría #${selectedLog.id}`}
          description={`Acción: ${selectedLog.accion} por ${selectedLog.actor_nombre}`}
          maxWidth="640px"
          footer={
            <Button variant="primary" onClick={() => setSelectedLog(null)}>
              Cerrar
            </Button>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                backgroundColor: 'var(--color-bg-subtle)',
                padding: '14px',
                borderRadius: 'var(--radius-md)',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px',
                fontSize: 'var(--font-size-xs)',
              }}
            >
              <div>
                <span style={{ color: 'var(--color-text-tertiary)' }}>Actor: </span>
                <strong>{selectedLog.actor_nombre}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-tertiary)' }}>Timestamp: </span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedLog.created_at}</span>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-tertiary)' }}>Entidad: </span>
                <strong>{selectedLog.entidad}</strong>
              </div>
              <div>
                <span style={{ color: 'var(--color-text-tertiary)' }}>Entidad ID: </span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{selectedLog.entidad_id || '—'}</span>
              </div>
            </div>

            {/* Cryptographic Hashes */}
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', marginBottom: '4px' }}>
                Hash Previo (Encadenamiento):
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-xs)',
                  padding: '8px 12px',
                  backgroundColor: 'var(--color-bg-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  wordBreak: 'break-all',
                  color: 'var(--color-text-secondary)',
                }}
              >
                {selectedLog.hash_previo || '0000000000000000000000000000000000000000000000000000000000000000 (Bloque Génesis)'}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', marginBottom: '4px' }}>
                Hash Actual SHA-256:
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-xs)',
                  padding: '8px 12px',
                  backgroundColor: 'var(--color-success-light)',
                  color: 'var(--color-success)',
                  borderRadius: 'var(--radius-sm)',
                  wordBreak: 'break-all',
                  fontWeight: 'var(--font-weight-semibold)',
                }}
              >
                {selectedLog.hash_actual}
              </div>
            </div>

            {/* JSON Payload Detail */}
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', marginBottom: '4px' }}>
                Detalle Técnico (Payload Sanitizado):
              </div>
              <pre
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--font-size-xs)',
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  overflowX: 'auto',
                  maxHeight: '200px',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {typeof selectedLog.detalle === 'object' && selectedLog.detalle !== null
                  ? JSON.stringify(selectedLog.detalle, null, 2)
                  : (selectedLog.detalle || 'Sin detalle adicional')}
              </pre>
            </div>
          </div>
        </Modal>
      )}
    </PageContainer>
  );
};
