import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import Redis from 'ioredis';
import {
  EMAIL_COMPOSER,
  IDEMPOTENCY_STORE,
  MAILER,
  type EmailComposer,
  type IdempotencyStore,
  type Mailer,
} from './application/ports';
import { NotifyVideoFailed } from './application/use-cases/notify-video-failed';
import { ENV, type Env } from './config/env';
import {
  CONSUMER,
  REDIS,
  SMTP_MAILER,
  SystemController,
} from './infrastructure/http/system.controller';
import { RedisIdempotencyStore } from './infrastructure/idempotency/redis-idempotency.store';
import { SmtpMailer } from './infrastructure/mail/smtp-mailer';
import { FailureEmailComposer } from './infrastructure/mail/template';
import { VideoFailedConsumer } from './infrastructure/messaging/video-failed.consumer';

const NOTIFY = Symbol('NotifyVideoFailed');

@Injectable()
export class Lifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Notification');

  constructor(
    @Inject(CONSUMER) private readonly consumer: VideoFailedConsumer,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SMTP_MAILER) private readonly mailer: SmtpMailer,
  ) {}

  onApplicationBootstrap(): void {
    // Não bloqueia o boot: se o RabbitMQ estiver fora, o consumo começa quando ele voltar
    this.consumer
      .start()
      .then(() => this.logger.log('Consumindo video.failed'))
      .catch((error: Error) => this.logger.error(`Consumidor: ${error.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.consumer.stop();
    await this.redis.quit().catch(() => undefined);
    this.mailer.close();
  }
}

@Module({
  controllers: [SystemController],
  providers: [
    Lifecycle,
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }),
    },
    {
      provide: SMTP_MAILER,
      inject: [ENV],
      useFactory: (env: Env) =>
        new SmtpMailer({
          host: env.SMTP_HOST,
          port: env.SMTP_PORT,
          secure: env.SMTP_SECURE,
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
          from: env.MAIL_FROM,
        }),
    },
    { provide: MAILER, useExisting: SMTP_MAILER },
    {
      provide: IDEMPOTENCY_STORE,
      inject: [REDIS, ENV],
      useFactory: (redis: Redis, env: Env) =>
        new RedisIdempotencyStore(redis, env.IDEMPOTENCY_TTL_DAYS),
    },
    {
      provide: EMAIL_COMPOSER,
      inject: [ENV],
      useFactory: (env: Env) => new FailureEmailComposer(env.APP_URL),
    },
    {
      provide: NOTIFY,
      inject: [MAILER, IDEMPOTENCY_STORE, EMAIL_COMPOSER],
      useFactory: (m: Mailer, i: IdempotencyStore, c: EmailComposer) =>
        new NotifyVideoFailed(m, i, c),
    },
    {
      provide: CONSUMER,
      inject: [ENV, NOTIFY],
      useFactory: (env: Env, notify: NotifyVideoFailed) =>
        new VideoFailedConsumer(env.RABBITMQ_URL, notify, env.CONSUMER_PREFETCH),
    },
  ],
})
export class NotificationModule {}
