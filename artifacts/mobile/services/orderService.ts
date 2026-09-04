import { apiClient } from '@/lib/auth/apiClient';

export interface CheckoutOrderItem {
  id: string | number;
  title: string;
  price: number;
  qty: number;
  is_course?: boolean;
  course_id?: string | number | null;
  [key: string]: any;
}

export interface CheckoutOrderRequest {
  total_amount: number;
  subtotal?: number;
  tax_amount?: number;
  discount_amount?: number;
  order_type?: string;
  shipping_address?: Record<string, any> | null;
  items?: CheckoutOrderItem[];
  razorpay_order_id?: string;
  razorpay_payment_id?: string;
  promo_code?: string | null;
  coupon_id?: string | null;
}

export interface RefundRequestPayload {
  reason: string;
}

export const orderService = {
  /**
   * Fetches all orders belonging to the authenticated student via GET /orders/me.
   * Student identity is derived exclusively from JWT.
   */
  async getMyOrders(): Promise<any[]> {
    try {
      const res = await apiClient.get<any>('/orders/me');
      const data = res?.data || res;
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('[OrderService] getMyOrders error:', error);
      throw error;
    }
  },

  /**
   * Fetches single order details by ID with server-side student ownership verification via GET /orders/:id.
   */
  async getOrder(orderId: string): Promise<any | null> {
    try {
      const res = await apiClient.get<any>(`/orders/${orderId}`);
      return res?.data || res || null;
    } catch (error) {
      console.error(`[OrderService] getOrder error for ${orderId}:`, error);
      throw error;
    }
  },

  /**
   * Creates an order through student checkout via POST /orders/checkout.
   * Student identity is derived exclusively from JWT.
   */
  async checkoutOrder(dto: CheckoutOrderRequest): Promise<any> {
    try {
      const res = await apiClient.post<any>('/orders/checkout', {
        total_amount: dto.total_amount,
        subtotal: dto.subtotal ?? dto.total_amount,
        tax_amount: dto.tax_amount ?? 0,
        discount_amount: dto.discount_amount ?? 0,
        order_type: dto.order_type || 'product',
        shipping_address: dto.shipping_address || undefined,
        items: dto.items,
        razorpay_order_id: dto.razorpay_order_id,
        razorpay_payment_id: dto.razorpay_payment_id,
        promo_code: dto.promo_code || undefined,
        coupon_id: dto.coupon_id || undefined,
      });
      return res?.data || res;
    } catch (error) {
      console.error('[OrderService] checkoutOrder error:', error);
      throw error;
    }
  },

  /**
   * Submits a refund request for an eligible order via POST /orders/:id/refund-request.
   * Server validates student ownership and eligibility.
   */
  async requestRefund(orderId: string, reason: string): Promise<any> {
    try {
      const res = await apiClient.post<any>(`/orders/${orderId}/refund-request`, {
        reason,
      });
      return res?.data || res;
    } catch (error) {
      console.error(`[OrderService] requestRefund error for ${orderId}:`, error);
      throw error;
    }
  },
};
