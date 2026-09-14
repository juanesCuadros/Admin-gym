import { apiClient } from './api/apiClient';
import { AuditLog, AuditChainVerification } from '@/types/audit.types';

export interface ListAuditParams {
  gimnasio_id?: string;
  actor_id?: string;
  accion?: string;
  limit?: number;
  offset?: number;
}

export const auditService = {
  async listAuditLogs(params: ListAuditParams = {}): Promise<AuditLog[]> {
    const response = await apiClient.get<AuditLog[]>('/admin/audit', {
      params: {
        gimnasio_id: params.gimnasio_id || undefined,
        actor_id: params.actor_id || undefined,
        accion: params.accion || undefined,
        limit: params.limit || 50,
        offset: params.offset || 0,
      },
    });
    return response.data;
  },

  async verifyChain(): Promise<AuditChainVerification> {
    const response = await apiClient.get<AuditChainVerification>('/admin/audit/verify-chain');
    return response.data;
  },
};
