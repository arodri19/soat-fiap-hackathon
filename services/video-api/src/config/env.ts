import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  DATABASE_URL: z.string().min(1),
  MIGRATE_ON_START: bool.default(true),
  RABBITMQ_URL: z.string().min(1),

  /** Endpoint S3 usado pelo serviço (rede interna do Docker). */
  S3_ENDPOINT: z.string().url(),
  /** Endpoint usado nas URLs pré-assinadas: precisa ser acessível pelo navegador. */
  S3_PUBLIC_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET_RAW: z.string().default('raw-videos'),
  S3_BUCKET_ZIP: z.string().default('frame-zips'),

  /** JWKS do auth-service para validar o access token localmente. */
  JWKS_URL: z.string().url(),
  JWT_ISSUER: z.string().default('fiapx-auth'),
  JWT_AUDIENCE: z.string().default('fiapx'),

  MAX_UPLOAD_MB: z.coerce.number().positive().default(500),
  DOWNLOAD_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  STATUS_CONSUMER_PREFETCH: z.coerce.number().int().positive().default(20),
  /** Desliga os workers em segundo plano (útil em testes isolados). */
  BACKGROUND_WORKERS: bool.default(true),

  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema>;

export const ENV = Symbol('Env');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuração inválida:\n${issues.join('\n')}`);
  }
  return parsed.data;
}

export const maxUploadBytes = (env: Env) => Math.floor(env.MAX_UPLOAD_MB * 1024 * 1024);
