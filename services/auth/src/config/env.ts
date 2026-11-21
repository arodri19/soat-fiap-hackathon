import { readFileSync } from 'node:fs';
import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    /** Aplica as migrations no boot (advisory lock: seguro com várias réplicas). */
    MIGRATE_ON_START: bool.default(true),

    JWT_PRIVATE_KEY: z.string().optional(),
    JWT_PRIVATE_KEY_FILE: z.string().optional(),
    JWT_ISSUER: z.string().default('fiapx-auth'),
    JWT_AUDIENCE: z.string().default('fiapx'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),

    COOKIE_SECURE: bool.default(true),
    COOKIE_PATH: z.string().default('/api/auth'),

    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),

    BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
    /** Quantos proxies confiáveis existem na frente do serviço (gateway = 1). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && !env.JWT_PRIVATE_KEY && !env.JWT_PRIVATE_KEY_FILE) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_PRIVATE_KEY'],
        message: 'JWT_PRIVATE_KEY ou JWT_PRIVATE_KEY_FILE é obrigatório em produção',
      });
    }
  });

export type Env = z.infer<typeof schema> & { jwtPrivateKeyPem?: string };

export const ENV = Symbol('Env');

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuração inválida:\n${issues.join('\n')}`);
  }
  const env = parsed.data;
  const jwtPrivateKeyPem = env.JWT_PRIVATE_KEY_FILE
    ? readFileSync(env.JWT_PRIVATE_KEY_FILE, 'utf8')
    : env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n');
  return { ...env, jwtPrivateKeyPem };
}
