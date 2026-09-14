import { apiClient } from './api/apiClient';
import {
  Payment,
  PaymentCreate,
  PaymentVoidRequest,
  SubscriptionUpdatePrice,
} from '@/types/payment.types';
import { SubscriptionResponse } from '@/types/gym.types';

export const paymentService = {
  async listPayments(gymId: string): Promise<Payment[]> {
    const response = await apiClient.get<Payment[]>(`/admin/gyms/${gymId}/payments`);
    return response.data;
  },

  async registerPayment(gymId: string, data: PaymentCreate): Promise<Payment> {
    const response = await apiClient.post<Payment>(`/admin/gyms/${gymId}/payments`, data);
    return response.data;
  },

  async voidPayment(paymentId: string, data: PaymentVoidRequest): Promise<Payment> {
    const response = await apiClient.post<Payment>(`/admin/payments/${paymentId}/void`, data);
    return response.data;
  },

  async updateSubscriptionPrice(
    gymId: string,
    data: SubscriptionUpdatePrice
  ): Promise<SubscriptionResponse> {
    const response = await apiClient.post<SubscriptionResponse>(
      `/admin/gyms/${gymId}/subscriptions/price`,
      data
    );
    return response.data;
  },
};
