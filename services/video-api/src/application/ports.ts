import type { Readable } from 'node:stream';
import type { Video, VideoStatus } from '../domain/video';

/** Mensagem gravada na outbox (mesma transação do vídeo) e publicada depois pelo relay. */
export interface OutboxMessage {
  exchange: string;
  routingKey: string;
  messageId: string;
  payload: Record<string, unknown>;
  headers: Record<string, string>;
}

export interface ListFilter {
  status?: VideoStatus;
  page: number;
  pageSize: number;
}

export type StatusCounts = Record<VideoStatus, number>;

export type StatusUpdate =
  | { status: 'PROCESSING' }
  | { status: 'DONE'; zipKey: string; frameCount: number }
  | { status: 'FAILED'; errorMessage: string };

export interface VideoRepository {
  /** Grava o vídeo e a mensagem da outbox numa única transação. */
  createWithMessage(video: Video, message: OutboxMessage): Promise<void>;
  findByIdForUser(id: string, userId: string): Promise<Video | null>;
  list(userId: string, filter: ListFilter): Promise<{ items: Video[]; total: number }>;
  countByStatus(userId: string): Promise<StatusCounts>;
  /**
   * Aplica a mudança só se o status atual estiver em `from`.
   * Retorna false quando o vídeo não existe ou a transição não é permitida.
   */
  applyStatus(id: string, update: StatusUpdate, from: VideoStatus[], at: Date): Promise<boolean>;
}

export interface VideoStorage {
  /** Grava o stream no bucket de vídeos e devolve o tamanho gravado. */
  uploadRaw(key: string, body: Readable, contentType: string): Promise<{ sizeBytes: number }>;
  deleteRaw(key: string): Promise<void>;
  /** URL temporária para baixar o zip, com nome de arquivo sugerido. */
  presignZipDownload(key: string, downloadName: string, ttlSeconds: number): Promise<string>;
}

export interface IdGenerator {
  newId(): string;
}

export interface Clock {
  now(): Date;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
}

export const VIDEO_REPOSITORY = Symbol('VideoRepository');
export const VIDEO_STORAGE = Symbol('VideoStorage');
export const ID_GENERATOR = Symbol('IdGenerator');
export const CLOCK = Symbol('Clock');

/** Exchange e routing keys definidos em contracts/asyncapi.yaml. */
export const EVENTS = {
  exchange: 'videos',
  requested: 'video.requested',
  processing: 'video.processing',
  done: 'video.done',
  failed: 'video.failed',
} as const;
