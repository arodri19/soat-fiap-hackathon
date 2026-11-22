import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CLOCK,
  ID_GENERATOR,
  VIDEO_REPOSITORY,
  VIDEO_STORAGE,
  type Clock,
  type IdGenerator,
  type VideoRepository,
  type VideoStorage,
} from './application/ports';
import { ApplyStatusEvent } from './application/use-cases/apply-status-event';
import { GetDownloadUrl, GetVideo, ListVideos } from './application/use-cases/query-videos';
import { UploadVideo } from './application/use-cases/upload-video';
import { ENV, type Env } from './config/env';
import {
  DATABASE,
  RABBITMQ,
  STORAGE,
  SystemController,
} from './infrastructure/http/system.controller';
import { USE_CASES, VideosController } from './infrastructure/http/videos.controller';
import { OutboxRelay } from './infrastructure/messaging/outbox-relay';
import { RabbitMq } from './infrastructure/messaging/rabbitmq';
import { StatusEventsConsumer } from './infrastructure/messaging/status-events.consumer';
import { Database } from './infrastructure/persistence/database';
import { PgVideoRepository } from './infrastructure/persistence/pg-video.repository';
import {
  JwksTokenVerifier,
  JwtAuthGuard,
  TOKEN_VERIFIER,
} from './infrastructure/security/jwt-auth.guard';
import { S3VideoStorage } from './infrastructure/storage/s3-video-storage';

const OUTBOX_RELAY = Symbol('OutboxRelay');
const STATUS_CONSUMER = Symbol('StatusEventsConsumer');

/** Liga/desliga os workers em segundo plano junto com a aplicação e fecha as conexões. */
@Injectable()
export class Lifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('VideoApi');

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(OUTBOX_RELAY) private readonly relay: OutboxRelay,
    @Inject(STATUS_CONSUMER) private readonly consumer: StatusEventsConsumer,
    @Inject(RABBITMQ) private readonly rabbit: RabbitMq,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: S3VideoStorage,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.BACKGROUND_WORKERS) return;
    this.relay.start();
    // Não bloqueia o boot: se o RabbitMQ estiver fora, o consumo começa quando ele voltar
    this.consumer
      .start()
      .then(() => this.logger.log('Consumindo eventos de status'))
      .catch((error: Error) => this.logger.error(`Consumidor de status: ${error.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.relay.stop();
    await this.consumer.stop();
    await this.rabbit.close();
    await this.db.close();
    this.storage.destroy();
  }
}

@Module({
  controllers: [VideosController, SystemController],
  providers: [
    JwtAuthGuard,
    Lifecycle,
    { provide: DATABASE, inject: [ENV], useFactory: (env: Env) => new Database(env.DATABASE_URL) },
    { provide: RABBITMQ, inject: [ENV], useFactory: (env: Env) => new RabbitMq(env.RABBITMQ_URL) },
    {
      provide: STORAGE,
      inject: [ENV],
      useFactory: (env: Env) =>
        new S3VideoStorage({
          endpoint: env.S3_ENDPOINT,
          publicEndpoint: env.S3_PUBLIC_ENDPOINT,
          region: env.S3_REGION,
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
          rawBucket: env.S3_BUCKET_RAW,
          zipBucket: env.S3_BUCKET_ZIP,
        }),
    },
    { provide: VIDEO_STORAGE, useExisting: STORAGE },
    {
      provide: TOKEN_VERIFIER,
      inject: [ENV],
      useFactory: (env: Env) =>
        new JwksTokenVerifier({
          jwksUrl: env.JWKS_URL,
          issuer: env.JWT_ISSUER,
          audience: env.JWT_AUDIENCE,
        }),
    },
    {
      provide: VIDEO_REPOSITORY,
      inject: [DATABASE],
      useFactory: (db: Database) => new PgVideoRepository(db),
    },
    { provide: ID_GENERATOR, useValue: { newId: () => randomUUID() } satisfies IdGenerator },
    { provide: CLOCK, useValue: { now: () => new Date() } satisfies Clock },
    {
      provide: USE_CASES.upload,
      inject: [VIDEO_REPOSITORY, VIDEO_STORAGE, ID_GENERATOR, CLOCK],
      useFactory: (r: VideoRepository, s: VideoStorage, i: IdGenerator, c: Clock) =>
        new UploadVideo(r, s, i, c),
    },
    {
      provide: USE_CASES.list,
      inject: [VIDEO_REPOSITORY],
      useFactory: (r: VideoRepository) => new ListVideos(r),
    },
    {
      provide: USE_CASES.get,
      inject: [VIDEO_REPOSITORY],
      useFactory: (r: VideoRepository) => new GetVideo(r),
    },
    {
      provide: USE_CASES.download,
      inject: [VIDEO_REPOSITORY, VIDEO_STORAGE, ENV],
      useFactory: (r: VideoRepository, s: VideoStorage, env: Env) =>
        new GetDownloadUrl(r, s, env.DOWNLOAD_URL_TTL_SECONDS),
    },
    {
      provide: USE_CASES.applyStatus,
      inject: [VIDEO_REPOSITORY, CLOCK],
      useFactory: (r: VideoRepository, c: Clock) => new ApplyStatusEvent(r, c),
    },
    {
      provide: OUTBOX_RELAY,
      inject: [DATABASE, RABBITMQ, ENV],
      useFactory: (db: Database, rabbit: RabbitMq, env: Env) =>
        new OutboxRelay(db, rabbit, {
          intervalMs: env.OUTBOX_POLL_INTERVAL_MS,
          batchSize: env.OUTBOX_BATCH_SIZE,
        }),
    },
    {
      provide: STATUS_CONSUMER,
      inject: [RABBITMQ, USE_CASES.applyStatus, ENV],
      useFactory: (rabbit: RabbitMq, apply: ApplyStatusEvent, env: Env) =>
        new StatusEventsConsumer(rabbit, apply, env.STATUS_CONSUMER_PREFETCH),
    },
  ],
})
export class VideoModule {}
