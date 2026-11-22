/**
 * Teste de integração com infraestrutura real (Testcontainers): RabbitMQ com a
 * topologia de infra/rabbitmq/definitions.json, Redis e Mailpit (caixa SMTP).
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import amqp from 'amqplib';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/config/env';
import { configureApp } from '../src/main';

const RABBIT_DIR = resolve(__dirname, '../../../infra/rabbitmq');

const until = async <T>(fn: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando condição');
    await new Promise((r) => setTimeout(r, 200));
  }
};

interface MailpitSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

describe('notification-service (E2E)', () => {
  let rabbit: StartedTestContainer;
  let redis: StartedRedisContainer;
  let mailpit: StartedTestContainer;
  let app: INestApplication<App>;
  let conn: amqp.ChannelModel;
  let ch: amqp.Channel;
  let mailpitApi: string;

  beforeAll(async () => {
    [rabbit, redis, mailpit] = await Promise.all([
      new GenericContainer('rabbitmq:3.13-management-alpine')
        .withCopyFilesToContainer([
          { source: `${RABBIT_DIR}/rabbitmq.conf`, target: '/etc/rabbitmq/conf.d/20-fiapx.conf' },
          { source: `${RABBIT_DIR}/definitions.json`, target: '/etc/rabbitmq/definitions.json' },
        ])
        .withExposedPorts(5672)
        .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
        .withStartupTimeout(120_000)
        .start(),
      new RedisContainer('redis:7-alpine').start(),
      new GenericContainer('axllent/mailpit:v1.24')
        .withExposedPorts(1025, 8025)
        .withWaitStrategy(Wait.forHttp('/livez', 8025))
        .start(),
    ]);
    mailpitApi = `http://127.0.0.1:${mailpit.getMappedPort(8025)}/api/v1`;
    const rabbitUrl = `amqp://fiapx:fiapx@127.0.0.1:${rabbit.getMappedPort(5672)}`;

    const env = loadEnv({
      NODE_ENV: 'test',
      RABBITMQ_URL: rabbitUrl,
      REDIS_URL: redis.getConnectionUrl(),
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(mailpit.getMappedPort(1025)),
      APP_URL: 'http://localhost:8080',
      LOG_LEVEL: 'silent',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    conn = await amqp.connect(rabbitUrl);
    ch = await conn.createChannel();
  });

  afterAll(async () => {
    await app?.close();
    await conn?.close().catch(() => undefined);
    await Promise.all([rabbit?.stop(), redis?.stop(), mailpit?.stop()]);
  });

  const failedEvent = (overrides: Record<string, unknown> = {}) => ({
    event_id: randomUUID(),
    occurred_at: new Date().toISOString(),
    video_id: randomUUID(),
    user_id: randomUUID(),
    user_email: 'ana@exemplo.com',
    original_filename: 'corrompido.mkv',
    error: 'ffmpeg: Invalid data found when processing input',
    attempts: 1,
    ...overrides,
  });

  const publish = (body: unknown) =>
    ch.publish(
      'videos',
      'video.failed',
      Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
      {
        persistent: true,
        contentType: 'application/json',
      },
    );

  const inbox = async (): Promise<MailpitSummary[]> =>
    ((await (await fetch(`${mailpitApi}/messages`)).json()) as { messages: MailpitSummary[] })
      .messages;

  const mailTo = (address: string) =>
    until(async () => {
      const found = (await inbox()).filter((m) => m.To.some((t) => t.Address === address));
      return found.length > 0 ? found : undefined;
    });

  it('video.failed gera um e-mail para o dono do vídeo, com o motivo e o link', async () => {
    publish(
      failedEvent({
        user_email: 'dono@exemplo.com',
        original_filename: 'aula 01.mp4',
        attempts: 3,
      }),
    );

    const [summary] = await mailTo('dono@exemplo.com');
    expect(summary.Subject).toBe('Falha ao processar o vídeo "aula 01.mp4"');

    const message = (await (await fetch(`${mailpitApi}/message/${summary.ID}`)).json()) as {
      From: { Address: string; Name: string };
      Text: string;
      HTML: string;
    };
    expect(message.From).toMatchObject({ Name: 'FIAP X', Address: 'nao-responda@fiapx.local' });
    expect(message.Text).toContain('após 3 tentativas');
    expect(message.Text).toContain('Motivo: ffmpeg: Invalid data found when processing input');
    expect(message.HTML).toContain('href="http://localhost:8080/videos"');
  });

  it('o mesmo evento entregue duas vezes gera um único e-mail (idempotência via Redis)', async () => {
    const event = failedEvent({ user_email: 'duplicado@exemplo.com' });
    publish(event);
    publish(event);

    await mailTo('duplicado@exemplo.com');
    await new Promise((r) => setTimeout(r, 1500)); // tempo para a 2ª entrega ser processada
    const all = (await inbox()).filter((m) =>
      m.To.some((t) => t.Address === 'duplicado@exemplo.com'),
    );
    expect(all).toHaveLength(1);
  });

  it('mensagem fora do contrato vai para a DLQ e não gera e-mail', async () => {
    publish({ video_id: 'sem-os-outros-campos' });

    const dead = await until(async () => {
      const msg = await ch.get('notification.video-events.dlq', { noAck: true });
      return msg ? msg.content.toString() : undefined;
    });
    expect(dead).toContain('sem-os-outros-campos');
  });

  it('health verifica RabbitMQ, Redis e SMTP; métricas contam envios e duplicados', async () => {
    const health = await request(app.getHttpServer()).get('/health').expect(200);
    expect(health.body).toEqual({
      status: 'ok',
      checks: { rabbitmq: true, redis: true, smtp: true },
    });

    const metrics = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(metrics.text).toMatch(/notifications_total\{result="sent",service="notification"\} 2/);
    expect(metrics.text).toMatch(
      /notifications_total\{result="duplicate",service="notification"\} 1/,
    );
    expect(metrics.text).toMatch(
      /notifications_total\{result="invalid",service="notification"\} 1/,
    );
  });
});
