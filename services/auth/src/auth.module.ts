import { Logger, Module, type OnApplicationShutdown, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import {
  ACCESS_TOKEN_SERVICE,
  CLOCK,
  LOGIN_RATE_LIMITER,
  OPAQUE_TOKEN_GENERATOR,
  PASSWORD_HASHER,
  REFRESH_TOKEN_REPOSITORY,
  SESSION_SETTINGS,
  USER_REPOSITORY,
  type AccessTokenService,
  type Clock,
  type LoginRateLimiter,
  type OpaqueTokenGenerator,
  type PasswordHasher,
  type RefreshTokenRepository,
  type SessionSettings,
  type UserRepository,
} from './application/ports';
import { SessionIssuer } from './application/session-issuer';
import { GetCurrentUser } from './application/use-cases/get-current-user';
import { Login } from './application/use-cases/login';
import { Logout } from './application/use-cases/logout';
import { RefreshSession } from './application/use-cases/refresh-session';
import { RegisterUser } from './application/use-cases/register-user';
import { ENV, type Env } from './config/env';
import { AuthController, USE_CASES } from './infrastructure/http/auth.controller';
import { JwtAuthGuard } from './infrastructure/http/jwt-auth.guard';
import { DATABASE, REDIS, SystemController } from './infrastructure/http/system.controller';
import { Database } from './infrastructure/persistence/database';
import { PgRefreshTokenRepository } from './infrastructure/persistence/pg-refresh-token.repository';
import { PgUserRepository } from './infrastructure/persistence/pg-user.repository';
import { RedisLoginRateLimiter } from './infrastructure/rate-limit/redis-login-rate-limiter';
import { BcryptPasswordHasher } from './infrastructure/security/bcrypt-password-hasher';
import { JoseAccessTokenService } from './infrastructure/security/jose-access-token-service';
import { CryptoOpaqueTokenGenerator } from './infrastructure/security/opaque-token-generator';

const SESSION_ISSUER = Symbol('SessionIssuer');

/**
 * Composição (injeção de dependência). Os casos de uso são classes puras, sem
 * decorators do Nest: aqui cada porta é ligada à sua implementação.
 */
@Module({
  controllers: [AuthController, SystemController],
  providers: [
    JwtAuthGuard,
    {
      provide: DATABASE,
      inject: [ENV],
      useFactory: (env: Env) => new Database(env.DATABASE_URL),
    },
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 }),
    },
    {
      provide: USER_REPOSITORY,
      inject: [DATABASE],
      useFactory: (db: Database) => new PgUserRepository(db),
    },
    {
      provide: REFRESH_TOKEN_REPOSITORY,
      inject: [DATABASE],
      useFactory: (db: Database) => new PgRefreshTokenRepository(db),
    },
    {
      provide: PASSWORD_HASHER,
      inject: [ENV],
      useFactory: (env: Env) => new BcryptPasswordHasher(env.BCRYPT_COST),
    },
    {
      provide: ACCESS_TOKEN_SERVICE,
      inject: [ENV],
      useFactory: async (env: Env) => {
        if (!env.jwtPrivateKeyPem) {
          new Logger('AuthModule').warn(
            'JWT_PRIVATE_KEY não definida: usando chave temporária (tokens deixam de valer ao reiniciar)',
          );
        }
        return JoseAccessTokenService.create(
          {
            issuer: env.JWT_ISSUER,
            audience: env.JWT_AUDIENCE,
            ttlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
          },
          env.jwtPrivateKeyPem,
        );
      },
    },
    { provide: OPAQUE_TOKEN_GENERATOR, useClass: CryptoOpaqueTokenGenerator },
    {
      provide: LOGIN_RATE_LIMITER,
      inject: [REDIS, ENV],
      useFactory: (redis: Redis, env: Env) =>
        new RedisLoginRateLimiter(redis, {
          maxAttempts: env.LOGIN_MAX_ATTEMPTS,
          windowSeconds: env.LOGIN_WINDOW_SECONDS,
        }),
    },
    { provide: CLOCK, useValue: { now: () => new Date() } satisfies Clock },
    {
      provide: SESSION_SETTINGS,
      inject: [ENV],
      useFactory: (env: Env): SessionSettings => ({
        refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      }),
    },
    {
      provide: SESSION_ISSUER,
      inject: [
        ACCESS_TOKEN_SERVICE,
        REFRESH_TOKEN_REPOSITORY,
        OPAQUE_TOKEN_GENERATOR,
        CLOCK,
        SESSION_SETTINGS,
      ],
      useFactory: (
        a: AccessTokenService,
        r: RefreshTokenRepository,
        t: OpaqueTokenGenerator,
        c: Clock,
        s: SessionSettings,
      ) => new SessionIssuer(a, r, t, c, s),
    },
    {
      provide: USE_CASES.register,
      inject: [USER_REPOSITORY, PASSWORD_HASHER],
      useFactory: (u: UserRepository, h: PasswordHasher) => new RegisterUser(u, h),
    },
    {
      provide: USE_CASES.login,
      inject: [USER_REPOSITORY, PASSWORD_HASHER, LOGIN_RATE_LIMITER, SESSION_ISSUER],
      useFactory: (u: UserRepository, h: PasswordHasher, l: LoginRateLimiter, s: SessionIssuer) =>
        new Login(u, h, l, s),
    },
    {
      provide: USE_CASES.refresh,
      inject: [
        USER_REPOSITORY,
        REFRESH_TOKEN_REPOSITORY,
        OPAQUE_TOKEN_GENERATOR,
        SESSION_ISSUER,
        CLOCK,
      ],
      useFactory: (
        u: UserRepository,
        r: RefreshTokenRepository,
        t: OpaqueTokenGenerator,
        s: SessionIssuer,
        c: Clock,
      ) => new RefreshSession(u, r, t, s, c),
    },
    {
      provide: USE_CASES.logout,
      inject: [REFRESH_TOKEN_REPOSITORY, OPAQUE_TOKEN_GENERATOR, CLOCK],
      useFactory: (r: RefreshTokenRepository, t: OpaqueTokenGenerator, c: Clock) =>
        new Logout(r, t, c),
    },
    {
      provide: USE_CASES.me,
      inject: [USER_REPOSITORY],
      useFactory: (u: UserRepository) => new GetCurrentUser(u),
    },
  ],
})
export class AuthModule implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.redis.quit().catch(() => undefined), this.db.close()]);
  }
}
