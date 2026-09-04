import { apiClient } from '@/lib/auth/apiClient';

const newsThumbnails = [
  require('@/assets/images/news_1.webp'),
  require('@/assets/images/news_2.webp'),
  require('@/assets/images/news_3.webp'),
  require('@/assets/images/news_4.webp'),
  require('@/assets/images/news_5.webp'),
];

export const getDeterministicThumbnail = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % newsThumbnails.length;
  return newsThumbnails[index];
};

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: string;
  author: string;
  date: string;
  readTime: string;
  thumbnail: any;
  tags: string[];
}

export function mapBackendNews(row: any): NewsArticle {
  const rawContent = row.content || '';
  // Clean markdown/HTML snippets for summary
  const cleanText = rawContent
    .replace(/[#*`_\[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const summary = cleanText
    ? cleanText.substring(0, 110) + (cleanText.length > 110 ? '...' : '')
    : 'Stay updated with the latest news and announcements from MakersFlow.';

  const wordCount = rawContent.split(/\s+/).filter(Boolean).length || 0;
  const readMinutes = Math.max(1, Math.round(wordCount / 200));

  let formattedDate = 'Recent';
  if (row.created_at) {
    try {
      formattedDate = new Date(row.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      formattedDate = 'Recent';
    }
  }

  const thumbnail = row.thumbnail_url
    ? { uri: row.thumbnail_url }
    : getDeterministicThumbnail(String(row.id));

  return {
    id: String(row.id),
    title: row.title || 'Untitled Article',
    content: rawContent,
    summary,
    category: row.category || 'Announcement',
    author: row.author || 'MakersFlow Team',
    date: formattedDate,
    readTime: `${readMinutes} min read`,
    thumbnail,
    tags: Array.isArray(row.tags) ? row.tags : ['MakersFlow', 'Update'],
  };
}

export async function fetchAllNews(): Promise<NewsArticle[]> {
  try {
    const response = await apiClient.get<any>('/news');
    const rawList = Array.isArray(response)
      ? response
      : (Array.isArray(response?.data) ? response.data : []);

    if (!rawList || rawList.length === 0) return [];

    return rawList
      .filter((row: any) => !row.status || row.status === 'published' || row.status === 'active')
      .map((row: any) => mapBackendNews(row));
  } catch (error) {
    console.error('[newsService] Error fetching news:', error);
    throw error;
  }
}

export async function fetchNewsById(id: string | number): Promise<NewsArticle | null> {
  if (!id || String(id) === 'undefined' || String(id) === 'null') {
    return null;
  }

  try {
    const response = await apiClient.get<any>(`/news/${id}`);
    const raw = response?.data !== undefined && response?.success !== undefined ? response.data : response;

    if (!raw || typeof raw !== 'object' || !raw.id) {
      return null;
    }

    return mapBackendNews(raw);
  } catch (error: any) {
    if (error?.status === 404) {
      return null;
    }
    console.error(`[newsService] Error fetching news article ${id}:`, error);
    throw error;
  }
}

export const newsService = {
  getAll: fetchAllNews,
  getNews: fetchAllNews,
  getById: fetchNewsById,
  getNewsById: fetchNewsById,
};
