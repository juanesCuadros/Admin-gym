import { useState, useEffect, useCallback } from 'react';
import { AuditLog, AuditChainVerification } from '@/types/audit.types';
import { auditService, ListAuditParams } from '@/services/auditService';
import { parseApiError } from '@/services/api/errorHandler';

export function useAudit(initialParams: ListAuditParams = {}) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [verification, setVerification] = useState<AuditChainVerification | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [gimnasioId, setGimnasioId] = useState<string>(initialParams.gimnasio_id || '');
  const [actorId, setActorId] = useState<string>(initialParams.actor_id || '');
  const [accion, setAccion] = useState<string>(initialParams.accion || '');
  const [limit, setLimit] = useState<number>(initialParams.limit || 50);
  const [offset, setOffset] = useState<number>(initialParams.offset || 0);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await auditService.listAuditLogs({
        gimnasio_id: gimnasioId || undefined,
        actor_id: actorId || undefined,
        accion: accion || undefined,
        limit,
        offset,
      });
      setLogs(data);
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  }, [gimnasioId, actorId, accion, limit, offset]);

  const verifyChain = useCallback(async () => {
    setIsVerifying(true);
    try {
      const result = await auditService.verifyChain();
      setVerification(result);
      return result;
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
      return null;
    } finally {
      setIsVerifying(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    verifyChain();
  }, [fetchLogs, verifyChain]);

  return {
    logs,
    verification,
    isLoading,
    isVerifying,
    error,
    gimnasioId,
    setGimnasioId,
    actorId,
    setActorId,
    accion,
    setAccion,
    limit,
    setLimit,
    offset,
    setOffset,
    refetch: fetchLogs,
    verifyChain,
  };
}
