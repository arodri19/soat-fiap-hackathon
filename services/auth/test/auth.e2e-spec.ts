/**
 * Teste de integração: Postgres e Redis reais (Testcontainers), migrations aplicadas
 * pelo executor de migrations e a API HTTP completa (rotas, cookies, erros e métricas).
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadEnv } from '../src/config/env';
import { runMigrations } from '../src/infrastructure/persistence/migrate';
import { configureApp } from '../src/main';

describe('auth-service (E2E)', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedRedisContainer;
  let app: INestApplication<App>;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine').start(),
      new RedisContainer('redis:7-alpine').start(),
    ]);
    const databaseUrl = postgres.getConnectionUri();
    const pool = new Pool({ connectionString: databaseUrl });
    const first = await runMigrations(pool);
    const second = await runMigrations(pool); // idempotente
    await pool.end();
    expect(first.applied).toEqual(['001_init.sql']);
    expect(second.applied).toEqual([]);

    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: redis.getConnectionUrl(),
      COOKIE_SECURE: 'false',
      BCRYPT_COST: '4',
      LOGIN_MAX_ATTEMPTS: '3',
      LOG_LEVEL: 'silent',
      MIGRATE_ON_START: 'false',
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, env);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  const http = () => request(app.getHttpServer());
  const ana = { name: 'Ana Souza', email: 'ana@exemplo.com', password: 'senhaForte1' };

  const refreshCookie = (res: request.Response): string => {
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    const cookie = cookies.find((c) => c.startsWith('refresh_token='));
    if (!cookie) throw new Error('cookie refresh_token ausente');
    return cookie;
  };
  const cookieValue = (setCookie: string) => setCookie.split(';')[0];

  describe('POST /auth/register', () => {
    it('cria a conta (201) sem expor a senha', async () => {
      const res = await http().post('/auth/register').send(ana).expect(201);

      expect(res.body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: 'Ana Souza',
        email: 'ana@exemplo.com',
        created_at: expect.any(String),
      });
    });

    it('e-mail repetido (com outra caixa) → 409', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ ...ana, email: 'ANA@exemplo.com' })
        .expect(409);
      expect(res.body).toEqual({ error: 'E-mail já cadastrado' });
    });

    it('dados inválidos → 400 com detalhes por campo', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ name: 'A', email: 'nao-e-email', password: 'x' })
        .expect(400);
      expect(res.body.error).toBe('Dados inválidos');
      expect(res.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'email',
        'name',
      ]);
    });

    it('senha fraca → 400 apontando o campo password', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ name: 'Bia', email: 'bia@exemplo.com', password: 'somenteletras' })
        .expect(400);
      expect(res.body.details).toEqual([
        { field: 'password', message: 'A senha deve conter ao menos uma letra e um número' },
      ]);
    });
  });

  describe('login, sessão e logout', () => {
    it('login → 200 com access token e cookie HttpOnly de refresh', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ email: ana.email, password: ana.password })
        .expect(200);

      expect(res.body).toMatchObject({
        access_token: expect.any(String),
        token_type: 'Bearer',
        expires_in: 900,
        user: { email: 'ana@exemplo.com', name: 'Ana Souza' },
      });
      expect(res.headers['cache-control']).toBe('no-store');
      const cookie = refreshCookie(res);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Strict/);
      expect(cookie).toMatch(/Path=\/api\/auth/);
    });

    it('/auth/me exige token válido', async () => {
      const login = await http().post('/auth/login').send(ana).expect(200);

      const me = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${login.body.access_token}`)
        .expect(200);
      expect(me.body.email).toBe('ana@exemplo.com');

      await http().get('/auth/me').expect(401);
      await http().get('/auth/me').set('Authorization', 'Bearer invalido').expect(401);
    });

    it('refresh rotaciona o cookie; reutilizar o antigo derruba a sessão inteira', async () => {
      const login = await http().post('/auth/login').send(ana).expect(200);
      const first = cookieValue(refreshCookie(login));

      const renewed = await http().post('/auth/refresh').set('Cookie', first).expect(200);
      const second = cookieValue(refreshCookie(renewed));
      expect(second).not.toBe(first);
      expect(renewed.body.access_token).toEqual(expect.any(String));

      // Reuso do token antigo: 401 e a família é revogada
      await http().post('/auth/refresh').set('Cookie', first).expect(401);
      await http().post('/auth/refresh').set('Cookie', second).expect(401);
    });

    it('logout → 204, apaga o cookie e o refresh deixa de valer', async () => {
      const login = await http().post('/auth/login').send(ana).expect(200);
      const cookie = cookieValue(refreshCookie(login));

      const out = await http().post('/auth/logout').set('Cookie', cookie).expect(204);
      expect(refreshCookie(out)).toMatch(/refresh_token=;/);

      await http().post('/auth/refresh').set('Cookie', cookie).expect(401);
      await http().post('/auth/logout').expect(204); // idempotente
    });

    it('refresh sem cookie → 401', async () => {
      await http().post('/auth/refresh').expect(401);
    });
  });

  describe('rate limit de login (Redis)', () => {
    it('após o limite de falhas responde 429 com Retry-After, por e-mail + IP', async () => {
      await http()
        .post('/auth/register')
        .send({ ...ana, email: 'rate@exemplo.com' })
        .expect(201);
      const wrong = { email: 'rate@exemplo.com', password: 'errada123' };

      for (let i = 0; i < 3; i++) {
        const res = await http().post('/auth/login').send(wrong).expect(401);
        expect(res.body).toEqual({ error: 'E-mail ou senha inválidos' });
      }

      const blocked = await http()
        .post('/auth/login')
        .send({ email: 'rate@exemplo.com', password: ana.password })
        .expect(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

      // Outro IP (via gateway: X-Forwarded-For) não é afetado
      await http()
        .post('/auth/login')
        .set('X-Forwarded-For', '203.0.113.9')
        .send({ email: 'rate@exemplo.com', password: ana.password })
        .expect(200);
    });
  });

  describe('rotas de infraestrutura', () => {
    it('JWKS publica a chave usada nos tokens', async () => {
      const login = await http().post('/auth/login').send(ana).expect(200);
      const kid = JSON.parse(
        Buffer.from(login.body.access_token.split('.')[0], 'base64url').toString(),
      ).kid;

      const res = await http().get('/.well-known/jwks.json').expect(200);
      expect(res.body.keys).toEqual([expect.objectContaining({ kid, alg: 'RS256', kty: 'RSA' })]);
    });

    it('health verifica banco e Redis', async () => {
      const res = await http().get('/health').expect(200);
      expect(res.body).toEqual({ status: 'ok', checks: { database: true, redis: true } });
    });

    it('métricas Prometheus incluem logins e latência por rota', async () => {
      const res = await http().get('/metrics').expect(200);
      expect(res.text).toMatch(/auth_login_attempts_total\{result="success",service="auth"\} \d+/);
      expect(res.text).toMatch(/auth_login_attempts_total\{result="rate_limited",service="auth"\}/);
      expect(res.text).toMatch(/http_request_duration_seconds_count\{.*route="\/auth\/login".*\}/);
    });
  });
});
