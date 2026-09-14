import { useState, useEffect, useCallback } from 'react';
import { Payment, PaymentCreate } from '@/types/payment.types';
import { SubscriptionResponse } from '@/types/gym.types';
import { paymentService } from '@/services/paymentService';
import { parseApiError } from '@/services/api/errorHandler';

export function usePayments(gymId?: string) {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPayments = useCallback(async () => {
    if (!gymId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await paymentService.listPayments(gymId);
      setPayments(data);
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.message);
    } finally {
      setIsLoading(false);
    }
  }, [gymId]);

  useEffect(() => {
    fetchPayments();
  }, [fetchPayments]);

  const registerPayment = async (data: PaymentCreate): Promise<Payment> => {
    if (!gymId) throw new Error('Gym ID is required');
    const result = await paymentService.registerPayment(gymId, data);
    await fetchPayments();
    return result;
  };

  const voidPayment = async (paymentId: string, motivo: string): Promise<Payment> => {
    const result = await paymentService.voidPayment(paymentId, { motivo_anulacion: motivo });
    await fetchPayments();
    return result;
  };

  const updatePrice = async (
    nuevoValor: number,
    desde?: string
  ): Promise<SubscriptionResponse> => {
    if (!gymId) throw new Error('Gym ID is required');
    return await paymentService.updateSubscriptionPrice(gymId, {
      nuevo_valor_mensual: nuevoValor,
      vigente_desde: desde,
    });
  };

  return {
    payments,
    isLoading,
    error,
    refetch: fetchPayments,
    registerPayment,
    voidPayment,
    updatePrice,
  };
}
