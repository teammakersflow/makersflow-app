import { apiClient } from '@/lib/auth/apiClient';

export interface AnnouncementItem {
  id: string;
  title: string;
  message?: string | null;
  content?: string | null;
  type?: string | null;
  link_url?: string | null;
  status?: string | null;
  created_at: string;
  scheduled_at?: string | null;
  [key: string]: any;
}

export const announcementService = {
  /**
   * Fetches active broadcast announcements for students via GET /announcements/active.
   */
  async getActiveAnnouncements(): Promise<AnnouncementItem[]> {
    try {
      const res = await apiClient.get<any>('/announcements/active');
      const data = res?.data || res;
      return Array.isArray(data) ? data : [];
    } catch (error) {
      console.error('[AnnouncementService] getActiveAnnouncements error:', error);
      return [];
    }
  },
};
