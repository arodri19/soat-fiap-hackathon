import { http } from './http';
import type { Video, VideoPage, VideoStatus } from './types';

export interface ListParams {
  page: number;
  pageSize: number;
  status?: VideoStatus | null;
}

export const videosApi = {
  list: ({ page, pageSize, status }: ListParams) =>
    http
      .get<VideoPage>('/videos', {
        params: { page, page_size: pageSize, ...(status ? { status } : {}) },
      })
      .then((r) => r.data),

  /** Upload multipart (campo "video") com progresso; um arquivo por requisição. */
  upload: (file: File, onProgress?: (fraction: number) => void) => {
    const form = new FormData();
    form.append('video', file);
    return http
      .post<Video>('/videos', form, {
        timeout: 0, // uploads grandes podem demorar
        onUploadProgress: (e) => e.total && onProgress?.(e.loaded / e.total),
      })
      .then((r) => r.data);
  },

  downloadUrl: (id: string) =>
    http.get<{ url: string; expires_in: number }>(`/videos/${id}/download`).then((r) => r.data),
};
