import { Module, type DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { NotificationModule } from './notification.module';
import { ENV, type Env } from './config/env';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            // Reaproveita o X-Request-Id do gateway para rastrear a requisição entre serviços
            genReqId: (req, res) => {
              const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
              res.setHeader('X-Request-Id', id);
              return id;
            },
            customProps: () => ({ service: 'notification' }),
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
            autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/metrics' },
          },
        }),
        NotificationModule,
      ],
      providers: [{ provide: ENV, useValue: env }],
      exports: [ENV],
    };
  }
}
