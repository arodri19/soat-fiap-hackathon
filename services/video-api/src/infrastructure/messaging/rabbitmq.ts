import amqp, { type AmqpConnectionManager, type ChannelWrapper } from 'amqp-connection-manager';
import type { ConfirmChannel } from 'amqplib';

/**
 * Conexão com o RabbitMQ com reconexão automática. A topologia (exchanges, filas,
 * DLQ) é criada por infra/rabbitmq/definitions.json; o serviço só publica e consome.
 */
export class RabbitMq {
  readonly connection: AmqpConnectionManager;
  /** Canal de publicação em modo confirm: publish só resolve depois do ack do broker. */
  readonly publisher: ChannelWrapper;

  constructor(url: string) {
    this.connection = amqp.connect([url], {
      heartbeatIntervalInSeconds: 15,
      reconnectTimeInSeconds: 2,
    });
    this.publisher = this.connection.createChannel({ json: false, confirm: true });
  }

  get isConnected(): boolean {
    return this.connection.isConnected();
  }

  async publish(
    exchange: string,
    routingKey: string,
    body: Buffer,
    options: { messageId: string; correlationId?: string; headers?: Record<string, string> },
  ): Promise<void> {
    await this.publisher.publish(exchange, routingKey, body, {
      persistent: true,
      contentType: 'application/json',
      timestamp: Math.floor(Date.now() / 1000),
      messageId: options.messageId,
      correlationId: options.correlationId,
      headers: options.headers,
      mandatory: true,
      // Sem isso, com o broker fora, o publish esperaria a reconexão indefinidamente
      timeout: 5000,
    });
  }

  consumerChannel(setup: (channel: ConfirmChannel) => Promise<unknown>): ChannelWrapper {
    return this.connection.createChannel({ json: false, setup });
  }

  async close(): Promise<void> {
    await this.publisher.close().catch(() => undefined);
    await this.connection.close().catch(() => undefined);
  }
}
