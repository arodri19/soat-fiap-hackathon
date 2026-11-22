/** Tipos dos contratos HTTP (contracts/openapi/auth.yaml e videos.yaml). */

export interface User {
  id: string;
  name: string;
  email: string;
  created_at: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  user: User;
}

export const VIDEO_STATUSES = ['PENDING', 'PROCESSING', 'DONE', 'FAILED'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export interface Video {
  id: string;
  original_filename: string;
  size_bytes: number;
  status: VideoStatus;
  frame_count: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export type StatusCounts = Record<VideoStatus, number>;

export interface VideoPage {
  items: Video[];
  page: number;
  page_size: number;
  total: number;
  counts: StatusCounts;
}

export interface ApiErrorBody {
  error: string;
  details?: { field: string; message: string }[];
}
