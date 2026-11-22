import { Logger } from '@nestjs/common';
import amqp, { type AmqpConnectionManager, type ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { z } from 'zod';
import type { NotifyVideoFailed } from '../../application/use-cases/notify-video-failed';
import { InvalidEventError, type VideoFailedEvent } from '../../domain/video-failed';
import { notifications } from '../observability/metrics';

/** Fila criada por infra/rabbitmq/definitions.json (binding: video.failed). */
export const QUEUE = 'notification.video-events';

const schema = z.object({
  event_id: z.string().uuid(),
  occurred_at: z.string().datetime({ offset: true }),
  video_id: z.string().uuid(),
  user_id: z.string().uuid(),
  user_email: z.string().email(),
  original_filename: z.string().min(1),
  error: z.string().min(1),
  attempts: z.number().int().positive(),
});

/** Valida a mensagem contra o contrato (AsyncAPI) e converte para o evento de domínio. */
export function parseVideoFailed(content: Buffer): VideoFailedEvent {
  let json: unknown;
  try {
    json = JSON.parse(content.toString('utf8'));
  } catch {
    throw new InvalidEventError('JSON inválido');
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new InvalidEventError(
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  const e = result.data;
  return {
    eventId: e.event_id,
    occurredAt: new Date(e.occurred_at),
    videoId: e.video_id,
    userId: e.user_id,
    userEmail: e.user_email,
    originalFilename: e.original_filename,
    error: e.error,
    attempts: e.attempts,
  };
}

/**
 * Consome video.failed e envia o e-mail.
 *  - enviado ou duplicado → ack
 *  - fora do contrato → nack sem requeue → DLQ
 *  - SMTP/Redis fora → espera e devolve para a fila (o e-mail sai quando voltar)
 */
export class VideoFailedConsumer {
  private readonly logger = new Logger(VideoFailedConsumer.name);
  readonly connection: AmqpConnectionManager;
  private channel?: ChannelWrapper;

  constructor(
    url: string,
    private readonly notify: NotifyVideoFailed,
    private readonly prefetch: number,
    private readonly retryDelayMs = 2000,
  ) {
    this.connection = amqp.connect([url], {
      heartbeatIntervalInSeconds: 15,
      reconnectTimeInSeconds: 2,
    });
  }

  get isConnected(): boolean {
    return this.connection.isConnected();
  }

  async start(): Promise<void> {
    this.channel = this.connection.createChannel({
      json: false,
      setup: async (channel: ConfirmChannel) => {
        await channel.prefetch(this.prefetch);
        await channel.consume(QUEUE, (msg) => msg && void this.handle(channel, msg), {
          noAck: false,
        });
      },
    });
    await this.channel.waitForConnect();
  }

  async stop(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }

  private async handle(channel: ConfirmChannel, msg: ConsumeMessage): Promise<void> {
    try {
      const event = parseVideoFailed(msg.content);
      const result = await this.notify.execute(event);
      notifications.inc({ result });
      this.logger.log(
        `E-mail de falha ${result === 'sent' ? 'enviado' : 'já enviado antes'} (vídeo ${event.videoId})`,
      );
      channel.ack(msg);
    } catch (error) {
      if (error instanceof InvalidEventError) {
        this.logger.warn(`Mensagem inválida enviada para a DLQ: ${error.message}`);
        notifications.inc({ result: 'invalid' });
        channel.nack(msg, false, false);
        return;
      }
      this.logger.error(
        `Falha ao enviar e-mail, nova tentativa em instantes: ${(error as Error).message}`,
      );
      notifications.inc({ result: 'retry' });
      setTimeout(() => {
        try {
          channel.nack(msg, false, true);
        } catch {
          /* canal fechado: o broker reentrega sozinho */
        }
      }, this.retryDelayMs);
    }
  }
}
