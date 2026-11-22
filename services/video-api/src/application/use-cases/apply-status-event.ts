import { ALLOWED_PREVIOUS_STATUS } from '../../domain/video';
import type { Clock, StatusUpdate, VideoRepository } from '../ports';

export interface StatusEvent {
  videoId: string;
  occurredAt: Date;
  update: StatusUpdate;
}

export type ApplyResult = 'applied' | 'ignored';

/**
 * Atualiza o status a partir dos eventos do worker (video.processing/done/failed).
 * Idempotente: evento repetido ou fora de ordem é ignorado em vez de regredir o status.
 */
export class ApplyStatusEvent {
  constructor(
    private readonly videos: VideoRepository,
    private readonly clock: Clock,
  ) {}

  async execute(event: StatusEvent): Promise<ApplyResult> {
    const applied = await this.videos.applyStatus(
      event.videoId,
      event.update,
      ALLOWED_PREVIOUS_STATUS[event.update.status],
      this.clock.now(),
    );
    return applied ? 'applied' : 'ignored';
  }
}
