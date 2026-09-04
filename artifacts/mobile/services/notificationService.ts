import { apiClient } from '@/lib/auth/apiClient';

export interface NotificationItem {
  id: string;
  user_id?: string;
  type: string;
  title: string;
  body?: string | null;
  link_url?: string | null;
  link?: string | null;
  action_url?: string | null;
  is_read: boolean;
  created_at: string;
  [key: string]: any;
}

export const notificationService = {
  /**
   * Fetches personal notifications belonging to the authenticated student via GET /notifications/me.
   * Student identity is derived exclusively from JWT.
   */
  async getMyNotifications(): Promise<NotificationItem[]> {
    try {
      const res = await apiClient.get<any>('/notifications/me');
      const data = res?.data || res;
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('[NotificationService] getMyNotifications error:', error);
      throw error;
    }
  },

  /**
   * Fetches unread notification count via GET /notifications/unread-count.
   */
  async getUnreadCount(): Promise<number> {
    try {
      const res = await apiClient.get<any>('/notifications/unread-count');
      const data = res?.data || res;
      if (typeof data?.unreadCount === 'number') {
        return data.unreadCount;
      }
      if (typeof data === 'number') {
        return data;
      }
      return 0;
    } catch (error) {
      console.error('[NotificationService] getUnreadCount error:', error);
      return 0;
    }
  },

  /**
   * Marks a single notification as read via PATCH /notifications/:id/read.
   */
  async markAsRead(notificationId: string): Promise<any> {
    try {
      const res = await apiClient.patch<any>(`/notifications/${notificationId}/read`);
      return res?.data || res;
    } catch (error) {
      console.error(`[NotificationService] markAsRead error for ${notificationId}:`, error);
      throw error;
    }
  },

  /**
   * Marks all personal notifications for the student as read via PATCH /notifications/read-all.
   */
  async markAllAsRead(): Promise<any> {
    try {
      const res = await apiClient.patch<any>('/notifications/read-all');
      return res?.data || res;
    } catch (error) {
      console.error('[NotificationService] markAllAsRead error:', error);
      throw error;
    }
  },

  /**
   * Deletes/dismisses a student's own notification via DELETE /notifications/:id.
   */
  async deleteNotification(notificationId: string): Promise<any> {
    try {
      const res = await apiClient.delete<any>(`/notifications/${notificationId}`);
      return res?.data || res;
    } catch (error) {
      console.error(`[NotificationService] deleteNotification error for ${notificationId}:`, error);
      throw error;
    }
  },
};
