import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

/** Configuração compartilhada entre o bootstrap e os testes E2E. */
export function configureApp(app: INestApplication): void {
  app.enableShutdownHooks();
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule.forRoot(env), { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  configureApp(app);
  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`notification-service ouvindo na porta ${env.PORT}`);
}

if (require.main === module) {
  void bootstrap();
}
