import type { VideoFailedEvent } from '../../domain/video-failed';
import type { EmailComposer, IdempotencyStore, Mailer } from '../ports';

export type NotifyResult = 'sent' | 'duplicate';

/**
 * Avisa o usuário por e-mail que o processamento do vídeo falhou
 * (requisito do PDF: "em caso de erro, um usuário pode ser notificado").
 */
export class NotifyVideoFailed {
  constructor(
    private readonly mailer: Mailer,
    private readonly idempotency: IdempotencyStore,
    private readonly composer: EmailComposer,
  ) {}

  async execute(event: VideoFailedEvent): Promise<NotifyResult> {
    if ((await this.idempotency.claim(event.eventId)) === 'already-handled') {
      return 'duplicate';
    }
    try {
      await this.mailer.send(this.composer.videoFailed(event));
    } catch (error) {
      await this.idempotency.release(event.eventId);
      throw error;
    }
    await this.idempotency.markSent(event.eventId);
    return 'sent';
  }
}
