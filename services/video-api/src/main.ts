import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadEnv, type Env } from './config/env';
import { ErrorFilter } from './infrastructure/http/error.filter';
import { httpMetricsMiddleware } from './infrastructure/observability/metrics';
import { DATABASE } from './infrastructure/http/system.controller';
import type { Database } from './infrastructure/persistence/database';
import { runMigrations } from './infrastructure/persistence/migrate';

/** Configuração compartilhada entre o bootstrap e os testes E2E. */
export function configureApp(app: INestApplication, env: Env): void {
  const express = app as NestExpressApplication;
  express.set('trust proxy', env.TRUST_PROXY_HOPS);
  express.disable('x-powered-by');
  app.use(httpMetricsMiddleware);
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
  });
  const logger = app.get(Logger);
  app.useLogger(logger);
  if (env.MIGRATE_ON_START) {
    const { applied } = await runMigrations(app.get<Database>(DATABASE).pool);
    logger.log(
      applied.length ? `Migrations aplicadas: ${applied.join(', ')}` : 'Banco já atualizado',
    );
  }
  configureApp(app, env);
  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`video-api ouvindo na porta ${env.PORT}`);
}

if (require.main === module) {
  void bootstrap();
}
