import { Logger } from '@nestjs/common';
import type { ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { z } from 'zod';
import type { ApplyStatusEvent, StatusEvent } from '../../application/use-cases/apply-status-event';
import { EVENTS } from '../../application/ports';
import { statusEvents } from '../observability/metrics';
import type { RabbitMq } from './rabbitmq';

export const STATUS_QUEUE = 'video-api.status-events';

const base = z.object({
  event_id: z.string().uuid(),
  occurred_at: z.string().datetime({ offset: true }),
  video_id: z.string().uuid(),
});

const schemas = {
  [EVENTS.processing]: base,
  [EVENTS.done]: base.extend({
    zip_key: z.string().min(1),
    frame_count: z.number().int().positive(),
  }),
  [EVENTS.failed]: base.extend({ error: z.string().min(1) }),
} as const;

class InvalidMessageError extends Error {}

/** Converte a mensagem AMQP no evento do caso de uso, validando contra o contrato (AsyncAPI). */
export function parseStatusMessage(routingKey: string, content: Buffer): StatusEvent {
  let json: unknown;
  try {
    json = JSON.parse(content.toString('utf8'));
  } catch {
    throw new InvalidMessageError('JSON inválido');
  }
  switch (routingKey) {
    case EVENTS.processing: {
      const e = parse(schemas[EVENTS.processing], json);
      return {
        videoId: e.video_id,
        occurredAt: new Date(e.occurred_at),
        update: { status: 'PROCESSING' },
      };
    }
    case EVENTS.done: {
      const e = parse(schemas[EVENTS.done], json);
      return {
        videoId: e.video_id,
        occurredAt: new Date(e.occurred_at),
        update: { status: 'DONE', zipKey: e.zip_key, frameCount: e.frame_count },
      };
    }
    case EVENTS.failed: {
      const e = parse(schemas[EVENTS.failed], json);
      return {
        videoId: e.video_id,
        occurredAt: new Date(e.occurred_at),
        update: { status: 'FAILED', errorMessage: e.error.slice(0, 2000) },
      };
    }
    default:
      throw new InvalidMessageError(`routing key inesperada: ${routingKey}`);
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, json: unknown): z.infer<T> {
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new InvalidMessageError(
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return result.data;
}

/**
 * Consome video.processing / video.done / video.failed da fila `video-api.status-events`.
 *  - sucesso ou evento ignorado (idempotência) → ack
 *  - mensagem inválida → nack sem requeue → vai para a DLQ (não adianta tentar de novo)
 *  - erro transitório (banco fora) → espera e devolve para a fila
 */
export class StatusEventsConsumer {
  private readonly logger = new Logger(StatusEventsConsumer.name);
  private channel?: ChannelWrapper;

  constructor(
    private readonly rabbit: RabbitMq,
    private readonly applyStatus: ApplyStatusEvent,
    private readonly prefetch: number,
    private readonly retryDelayMs = 1000,
  ) {}

  async start(): Promise<void> {
    this.channel = this.rabbit.consumerChannel(async (channel: ConfirmChannel) => {
      await channel.prefetch(this.prefetch);
      await channel.consume(STATUS_QUEUE, (msg) => msg && void this.handle(channel, msg), {
        noAck: false,
      });
    });
    await this.channel.waitForConnect();
  }

  async stop(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
  }

  private async handle(channel: ConfirmChannel, msg: ConsumeMessage): Promise<void> {
    const routingKey = msg.fields.routingKey;
    try {
      const event = parseStatusMessage(routingKey, msg.content);
      const result = await this.applyStatus.execute(event);
      statusEvents.inc({ routing_key: routingKey, result });
      channel.ack(msg);
    } catch (error) {
      if (error instanceof InvalidMessageError) {
        this.logger.warn(`Mensagem inválida em ${routingKey} enviada para a DLQ: ${error.message}`);
        statusEvents.inc({ routing_key: routingKey, result: 'invalid' });
        channel.nack(msg, false, false);
        return;
      }
      this.logger.error(`Erro ao aplicar ${routingKey}: ${(error as Error).message}`);
      statusEvents.inc({ routing_key: routingKey, result: 'retry' });
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
