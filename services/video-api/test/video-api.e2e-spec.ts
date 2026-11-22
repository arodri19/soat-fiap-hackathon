/**
 * Teste de integração da video-api com infraestrutura real (Testcontainers):
 * PostgreSQL, RabbitMQ (com a topologia de infra/rabbitmq/definitions.json) e MinIO.
 * O auth-service é substituído por um servidor JWKS local que assina tokens de teste.
 */
import { CreateBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import amqp from 'amqplib';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/infrastructure/persistence/migrate';
import { configureApp } from '../src/main';

const RABBIT_DIR = resolve(__dirname, '../../../infra/rabbitmq');
const MINIO = { user: 'minioadmin', password: 'minioadmin' };

const until = async <T>(fn: () => Promise<T | undefined>, timeoutMs = 15_000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - start > timeoutMs) throw new Error('timeout esperando condição');
    await new Promise((r) => setTimeout(r, 200));
  }
};

describe('video-api (E2E)', () => {
  let postgres: StartedPostgreSqlContainer;
  let rabbit: StartedTestContainer;
  let minio: StartedTestContainer;
  let jwks: Server;
  let privateKey: KeyLike;
  let app: INestApplication<App>;
  let amqpConn: amqp.ChannelModel;
  let amqpCh: amqp.Channel;
  let s3: S3Client;
  let db: Pool;

  const token = (sub: string, email: string) =>
    new SignJWT({ email, name: 'Teste' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject(sub)
      .setIssuer('fiapx-auth')
      .setAudience('fiapx')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  const ana = { id: randomUUID(), email: 'ana@exemplo.com' };
  const bia = { id: randomUUID(), email: 'bia@exemplo.com' };
  let anaToken: string;
  let biaToken: string;

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256');
    privateKey = keys.privateKey;
    const publicJwk = {
      ...(await exportJWK(keys.publicKey)),
      kid: 'test-key',
      alg: 'RS256',
      use: 'sig',
    };
    jwks = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((r) => jwks.listen(0, '127.0.0.1', r));

    [postgres, rabbit, minio] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new GenericContainer('rabbitmq:3.13-management-alpine')
        .withCopyFilesToContainer([
          { source: `${RABBIT_DIR}/rabbitmq.conf`, target: '/etc/rabbitmq/conf.d/20-fiapx.conf' },
          { source: `${RABBIT_DIR}/definitions.json`, target: '/etc/rabbitmq/definitions.json' },
        ])
        .withExposedPorts(5672)
        .withWaitStrategy(Wait.forLogMessage(/Server startup complete/))
        .withStartupTimeout(120_000)
        .start(),
      new GenericContainer('bitnamilegacy/minio:2025.4.22')
        .withEnvironment({
          MINIO_ROOT_USER: MINIO.user,
          MINIO_ROOT_PASSWORD: MINIO.password,
          MINIO_SKIP_CLIENT: 'yes', // evita o restart da imagem Bitnami no boot
        })
        .withExposedPorts(9000)
        .withWaitStrategy(Wait.forLogMessage(/API: http/))
        .start(),
    ]);

    const s3Endpoint = `http://127.0.0.1:${minio.getMappedPort(9000)}`;
    s3 = new S3Client({
      endpoint: s3Endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: { accessKeyId: MINIO.user, secretAccessKey: MINIO.password },
    });
    await s3.send(new CreateBucketCommand({ Bucket: 'raw-videos' }));
    await s3.send(new CreateBucketCommand({ Bucket: 'frame-zips' }));

    db = new Pool({ connectionString: postgres.getConnectionUri() });
    await runMigrations(db);

    const rabbitUrl = `amqp://fiapx:fiapx@127.0.0.1:${rabbit.getMappedPort(5672)}`;
    amqpConn = await amqp.connect(rabbitUrl);
    amqpCh = await amqpConn.createChannel();
    await amqpCh.consume('processor.video-requested', (msg) => {
      if (!msg) return;
      const body = JSON.parse(msg.content.toString());
      requested.set(body.video_id, { body, props: msg.properties });
      amqpCh.ack(msg);
    });

    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: postgres.getConnectionUri(),
      MIGRATE_ON_START: 'false',
      RABBITMQ_URL: rabbitUrl,
      S3_ENDPOINT: s3Endpoint,
      S3_PUBLIC_ENDPOINT: s3Endpoint,
      S3_ACCESS_KEY: MINIO.user,
      S3_SECRET_KEY: MINIO.password,
      JWKS_URL: `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/jwks.json`,
      MAX_UPLOAD_MB: '1',
      OUTBOX_POLL_INTERVAL_MS: '100',
      LOG_LEVEL: 'silent',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, env);
    await app.init();

    anaToken = await token(ana.id, ana.email);
    biaToken = await token(bia.id, bia.email);
  });

  afterAll(async () => {
    await app?.close();
    await amqpConn?.close().catch(() => undefined);
    await db?.end();
    jwks?.close();
    await Promise.all([postgres?.stop(), rabbit?.stop(), minio?.stop()]);
  });

  const http = () => request(app.getHttpServer());
  const upload = (tok: string, name: string, content: Buffer | string = 'video-bytes') =>
    http()
      .post('/videos')
      .set('Authorization', `Bearer ${tok}`)
      .set('X-Request-Id', 'req-e2e')
      .attach('video', Buffer.from(content), name);

  const publishStatus = (routingKey: string, payload: Record<string, unknown>) =>
    amqpCh.publish('videos', routingKey, Buffer.from(JSON.stringify(payload)), {
      persistent: true,
      contentType: 'application/json',
    });

  const getVideo = (id: string) =>
    http()
      .get(`/videos/${id}`)
      .set('Authorization', `Bearer ${anaToken}`)
      .then((r) => r.body);

  /** Mensagens video.requested recebidas na fila do worker, por video_id (simula o processor). */
  const requested = new Map<
    string,
    { body: Record<string, unknown>; props: amqp.MessageProperties }
  >();
  const takeRequested = (videoId: string) => until(async () => requested.get(videoId));

  describe('autenticação', () => {
    it('sem token ou com token inválido → 401', async () => {
      await http().get('/videos').expect(401);
      await http().get('/videos').set('Authorization', 'Bearer abc').expect(401);
    });
  });

  describe('upload', () => {
    it('aceita o vídeo (202), grava no MinIO e publica video.requested via outbox', async () => {
      const res = await upload(anaToken, 'apresentacao.mp4').expect(202);

      expect(res.body).toMatchObject({
        original_filename: 'apresentacao.mp4',
        size_bytes: 11,
        status: 'PENDING',
        frame_count: null,
      });
      expect(res.headers.location).toBe(`/videos/${res.body.id}`);

      const { body, props } = await takeRequested(res.body.id);
      expect(body).toMatchObject({
        video_id: res.body.id,
        user_id: ana.id,
        user_email: ana.email,
        original_filename: 'apresentacao.mp4',
        storage_key: `${ana.id}/${res.body.id}.mp4`,
      });
      expect(props.messageId).toBe(body.event_id);
      expect(props.correlationId).toBe(res.body.id);
      expect(props.deliveryMode).toBe(2); // persistente
      expect(props.headers?.['x-request-id']).toBe('req-e2e');

      const { rows } = await db.query('SELECT published_at FROM outbox WHERE message_id = $1', [
        body.event_id,
      ]);
      expect(rows[0].published_at).not.toBeNull();
    });

    it('vários uploads simultâneos são todos aceitos e enfileirados', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => upload(anaToken, `lote-${i}.webm`)),
      );
      expect(results.map((r) => r.status)).toEqual([202, 202, 202, 202, 202]);
      for (const r of results) await takeRequested(r.body.id);
    });

    it('formato não suportado → 400', async () => {
      const res = await upload(anaToken, 'planilha.xlsx').expect(400);
      expect(res.body.error).toMatch(/Formato não suportado/);
    });

    it('arquivo acima do limite → 413, e nada fica no banco', async () => {
      const before = await db.query('SELECT count(*) FROM videos');
      const res = await upload(anaToken, 'grande.mp4', Buffer.alloc(1.5 * 1024 * 1024)).expect(413);
      expect(res.body.error).toMatch(/limite de 1 MB/);
      const after = await db.query('SELECT count(*) FROM videos');
      expect(after.rows[0].count).toBe(before.rows[0].count);
    });

    it('sem o campo "video" → 400', async () => {
      await http()
        .post('/videos')
        .set('Authorization', `Bearer ${anaToken}`)
        .attach('outro', Buffer.from('x'), 'a.mp4')
        .expect(400);
    });
  });

  describe('ciclo de status e download', () => {
    it('PROCESSING → DONE pelos eventos do worker e download por URL temporária', async () => {
      const { body: video } = await upload(anaToken, 'Minha Aula.mov').expect(202);
      await takeRequested(video.id);
      const zipKey = `${ana.id}/${video.id}.zip`;
      await s3.send(new PutObjectCommand({ Bucket: 'frame-zips', Key: zipKey, Body: 'ZIPDATA' }));

      await http()
        .get(`/videos/${video.id}/download`)
        .set('Authorization', `Bearer ${anaToken}`)
        .expect(409);

      publishStatus('video.processing', {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        video_id: video.id,
      });
      await until(async () =>
        (await getVideo(video.id)).status === 'PROCESSING' ? true : undefined,
      );

      publishStatus('video.done', {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        video_id: video.id,
        zip_key: zipKey,
        frame_count: 42,
      });
      const done = await until(async () => {
        const v = await getVideo(video.id);
        return v.status === 'DONE' ? v : undefined;
      });
      expect(done.frame_count).toBe(42);

      // Evento atrasado não regride o status
      publishStatus('video.processing', {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        video_id: video.id,
      });

      const dl = await http()
        .get(`/videos/${video.id}/download`)
        .set('Authorization', `Bearer ${anaToken}`)
        .expect(200);
      expect(dl.body.expires_in).toBe(300);
      const file = await fetch(dl.body.url);
      expect(file.status).toBe(200);
      expect(file.headers.get('content-disposition')).toContain('Minha%20Aula_frames.zip');
      expect(await file.text()).toBe('ZIPDATA');

      await new Promise((r) => setTimeout(r, 500));
      expect((await getVideo(video.id)).status).toBe('DONE');
    });

    it('FAILED registra o motivo', async () => {
      const { body: video } = await upload(anaToken, 'corrompido.mkv').expect(202);
      publishStatus('video.failed', {
        event_id: randomUUID(),
        occurred_at: new Date().toISOString(),
        video_id: video.id,
        user_id: ana.id,
        user_email: ana.email,
        original_filename: 'corrompido.mkv',
        error: 'ffmpeg: Invalid data found when processing input',
        attempts: 3,
      });
      const failed = await until(async () => {
        const v = await getVideo(video.id);
        return v.status === 'FAILED' ? v : undefined;
      });
      expect(failed.error_message).toBe('ffmpeg: Invalid data found when processing input');
    });

    it('mensagem inválida vai para a DLQ em vez de travar a fila', async () => {
      amqpCh.publish('videos', 'video.done', Buffer.from('{"nao":"e o contrato"}'));
      const dead = await until(async () => {
        const msg = await amqpCh.get('video-api.status-events.dlq', { noAck: true });
        return msg ? msg.content.toString() : undefined;
      });
      expect(dead).toBe('{"nao":"e o contrato"}');
    });
  });

  describe('listagem e isolamento entre usuários', () => {
    it('lista com paginação, filtro e totais por status', async () => {
      const res = await http()
        .get('/videos?page=1&page_size=3')
        .set('Authorization', `Bearer ${anaToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(3);
      expect(res.body).toMatchObject({ page: 1, page_size: 3 });
      expect(res.body.total).toBeGreaterThanOrEqual(8);
      expect(res.body.counts).toMatchObject({ DONE: 1, FAILED: 1 });

      const failed = await http()
        .get('/videos?status=FAILED')
        .set('Authorization', `Bearer ${anaToken}`)
        .expect(200);
      expect(failed.body.items.map((v: { status: string }) => v.status)).toEqual(['FAILED']);
    });

    it('parâmetros inválidos → 400 com detalhes', async () => {
      const res = await http()
        .get('/videos?status=XPTO&page_size=1000')
        .set('Authorization', `Bearer ${anaToken}`)
        .expect(400);
      expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'page_size',
        'status',
      ]);
    });

    it('outro usuário não vê os vídeos da Ana (lista vazia e 404 no detalhe e download)', async () => {
      const { body: anaVideo } = await upload(anaToken, 'privado.mp4').expect(202);

      const list = await http()
        .get('/videos')
        .set('Authorization', `Bearer ${biaToken}`)
        .expect(200);
      expect(list.body.total).toBe(0);
      await http()
        .get(`/videos/${anaVideo.id}`)
        .set('Authorization', `Bearer ${biaToken}`)
        .expect(404);
      await http()
        .get(`/videos/${anaVideo.id}/download`)
        .set('Authorization', `Bearer ${biaToken}`)
        .expect(404);
      await http().get('/videos/nao-e-uuid').set('Authorization', `Bearer ${anaToken}`).expect(404);
    });
  });

  describe('rotas de infraestrutura', () => {
    it('health verifica banco, storage e RabbitMQ', async () => {
      const res = await http().get('/health').expect(200);
      expect(res.body).toEqual({
        status: 'ok',
        checks: { database: true, storage: true, rabbitmq: true },
      });
    });

    it('métricas incluem uploads, outbox e eventos de status', async () => {
      const res = await http().get('/metrics').expect(200);
      expect(res.text).toMatch(
        /videos_uploaded_total\{result="accepted",service="video-api"\} \d+/,
      );
      expect(res.text).toMatch(/outbox_published_total\{routing_key="video.requested"/);
      expect(res.text).toMatch(
        /video_status_events_total\{routing_key="video.done",result="applied"/,
      );
      // O relay publica a cada 100 ms: espera a outbox esvaziar em vez de ler um valor momentâneo
      await until(async () => {
        const m = await http().get('/metrics');
        return /outbox_pending\{service="video-api"\} 0/.test(m.text) ? true : undefined;
      });
    });
  });
});
