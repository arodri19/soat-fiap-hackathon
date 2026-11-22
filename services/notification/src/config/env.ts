import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3003),
  RABBITMQ_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  /** true = TLS direto (porta 465). Em 587, o STARTTLS é negociado automaticamente. */
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('FIAP X <nao-responda@fiapx.local>'),

  /** Endereço do front, usado no link "Ver meus vídeos" do e-mail. */
  APP_URL: z.string().url().default('http://localhost:8080'),
  CONSUMER_PREFETCH: z.coerce.number().int().positive().default(10),
  /** Por quantos dias um evento já enviado é lembrado (deduplicação). */
  IDEMPOTENCY_TTL_DAYS: z.coerce.number().int().positive().default(7),
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
