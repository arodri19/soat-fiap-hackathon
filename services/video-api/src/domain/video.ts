import { UnsupportedVideoFormatError } from './errors';

export const VIDEO_STATUSES = ['PENDING', 'PROCESSING', 'DONE', 'FAILED'] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export interface Video {
  id: string;
  userId: string;
  userEmail: string;
  originalFilename: string;
  sizeBytes: number;
  storageKey: string;
  zipKey: string | null;
  status: VideoStatus;
  frameCount: number | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const ALLOWED_EXTENSIONS = ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm'] as const;

/** Extensão em minúsculas, validada contra a lista de formatos aceitos. */
export function videoExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename);
  const ext = match?.[1].toLowerCase();
  if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new UnsupportedVideoFormatError(ALLOWED_EXTENSIONS);
  }
  return ext;
}

/**
 * Nome exibido ao usuário: só o nome do arquivo (sem caminho), sem caracteres de
 * controle e com no máximo 255 caracteres. Nunca é usado para montar caminhos.
 */
export function sanitizeFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (clean.length <= 255) return clean;
  const ext = clean.slice(clean.lastIndexOf('.'));
  return clean.slice(0, 255 - ext.length) + ext;
}

/** Chave no bucket de vídeos: o nome vem do ID, não do arquivo enviado (sem path traversal). */
export function rawVideoKey(userId: string, videoId: string, ext: string): string {
  return `${userId}/${videoId}.${ext}`;
}

/** Nome sugerido para o zip baixado: "apresentacao.mp4" → "apresentacao_frames.zip". */
export function zipDownloadName(originalFilename: string): string {
  const base = originalFilename.replace(/\.[^.]+$/, '') || 'video';
  return `${base}_frames.zip`;
}

/**
 * De quais status cada evento pode partir. Eventos fora de ordem ou repetidos
 * (entrega at-least-once) não fazem o status andar para trás.
 */
export const ALLOWED_PREVIOUS_STATUS: Record<Exclude<VideoStatus, 'PENDING'>, VideoStatus[]> = {
  PROCESSING: ['PENDING'],
  DONE: ['PENDING', 'PROCESSING'],
  FAILED: ['PENDING', 'PROCESSING'],
};
