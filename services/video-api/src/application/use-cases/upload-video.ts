import type { Readable } from 'node:stream';
import { EmptyVideoFileError } from '../../domain/errors';
import { rawVideoKey, sanitizeFilename, videoExtension, type Video } from '../../domain/video';
import {
  EVENTS,
  type AuthenticatedUser,
  type Clock,
  type IdGenerator,
  type VideoRepository,
  type VideoStorage,
} from '../ports';

export interface UploadVideoInput {
  user: AuthenticatedUser;
  filename: string;
  contentType: string;
  stream: Readable;
  requestId?: string;
}

/**
 * Recebe o vídeo e enfileira o processamento sem perder requisições:
 *  1. grava o arquivo no storage (streaming, sem guardar em memória);
 *  2. numa única transação, grava o vídeo como PENDING e a mensagem na outbox;
 *  3. o relay da outbox publica no RabbitMQ depois (mesmo que ele esteja fora agora).
 * Se algo falhar, o arquivo gravado é removido para não deixar lixo no bucket.
 */
export class UploadVideo {
  constructor(
    private readonly videos: VideoRepository,
    private readonly storage: VideoStorage,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(input: UploadVideoInput): Promise<Video> {
    let ext: string;
    try {
      ext = videoExtension(input.filename);
    } catch (error) {
      input.stream.resume(); // descarta o corpo para liberar a conexão
      throw error;
    }

    const id = this.ids.newId();
    const storageKey = rawVideoKey(input.user.id, id, ext);
    let stored = false;

    try {
      const { sizeBytes } = await this.storage.uploadRaw(
        storageKey,
        input.stream,
        input.contentType,
      );
      stored = true;
      if (sizeBytes === 0) throw new EmptyVideoFileError();

      const now = this.clock.now();
      const video: Video = {
        id,
        userId: input.user.id,
        userEmail: input.user.email,
        originalFilename: sanitizeFilename(input.filename),
        sizeBytes,
        storageKey,
        zipKey: null,
        status: 'PENDING',
        frameCount: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };

      const eventId = this.ids.newId();
      await this.videos.createWithMessage(video, {
        exchange: EVENTS.exchange,
        routingKey: EVENTS.requested,
        messageId: eventId,
        payload: {
          event_id: eventId,
          occurred_at: now.toISOString(),
          video_id: video.id,
          user_id: video.userId,
          user_email: video.userEmail,
          original_filename: video.originalFilename,
          storage_key: video.storageKey,
        },
        headers: input.requestId ? { 'x-request-id': input.requestId } : {},
      });
      return video;
    } catch (error) {
      // Upload interrompido (limite de tamanho, conexão caída) ou falha no banco
      await this.storage.deleteRaw(storageKey).catch(() => undefined);
      if (!stored) input.stream.resume();
      throw error;
    }
  }
}
