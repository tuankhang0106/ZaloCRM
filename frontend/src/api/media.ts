import { api } from './index';

export interface MediaFolder {
  id: string;
  orgId: string;
  name: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    items: number;
  };
}

export interface MediaItem {
  id: string;
  orgId: string;
  folderId?: string | null;
  name: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  createdById?: string;
  createdAt: string;
  updatedAt: string;
  folder?: MediaFolder | null;
  createdBy?: {
    id: string;
    fullName: string;
  };
}

export interface MediaFoldersResponse {
  folders: MediaFolder[];
  totalUncategorized: number;
  totalAll: number;
}

export interface MediaListResponse {
  items: MediaItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const mediaApi = {
  getFolders: async (): Promise<MediaFoldersResponse> => {
    const res = await api.get('/media/folders');
    return res.data;
  },

  createFolder: async (data: { name: string; color?: string }): Promise<MediaFolder> => {
    const res = await api.post('/media/folders', data);
    return res.data;
  },

  updateFolder: async (id: string, data: { name?: string; color?: string }): Promise<MediaFolder> => {
    const res = await api.put(`/media/folders/${id}`, data);
    return res.data;
  },

  deleteFolder: async (id: string): Promise<{ success: boolean }> => {
    const res = await api.delete(`/media/folders/${id}`);
    return res.data;
  },

  getMedia: async (params?: {
    folderId?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<MediaListResponse> => {
    const res = await api.get('/media', { params });
    return res.data;
  },

  uploadMedia: async (formData: FormData): Promise<{ success: boolean; count: number; items: MediaItem[] }> => {
    const res = await api.post('/media/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return res.data;
  },

  updateMedia: async (
    id: string,
    data: { name?: string; folderId?: string | null }
  ): Promise<MediaItem> => {
    const res = await api.put(`/media/${id}`, data);
    return res.data;
  },

  deleteMedia: async (id: string): Promise<{ success: boolean }> => {
    const res = await api.delete(`/media/${id}`);
    return res.data;
  },

  sendMediaToChat: async (
    conversationId: string,
    data: { mediaItemIds: string[]; caption?: string }
  ): Promise<{ success: boolean; sentCount: number; messages: any[] }> => {
    const res = await api.post(`/conversations/${conversationId}/send-media`, data);
    return res.data;
  },
};
