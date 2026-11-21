import type { RefreshTokenRecord } from '../domain/refresh-token';
import type { User } from '../domain/user';

/**
 * Portas (interfaces) que os casos de uso usam. As implementações ficam em
 * src/infrastructure e são ligadas por injeção de dependência (tokens abaixo).
 */

export interface NewUser {
  name: string;
  email: string;
  passwordHash: string;
}

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  /** Lança EmailAlreadyRegisteredError se o e-mail já existir (inclusive em corrida). */
  create(data: NewUser): Promise<User>;
}

export interface RefreshTokenRepository {
  create(record: Omit<RefreshTokenRecord, 'revokedAt' | 'replacedBy'>): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  /**
   * Revoga `currentId` apontando para o novo token e grava o novo, numa transação.
   * Retorna false se `currentId` já tinha sido revogado (outra requisição rotacionou antes).
   */
  rotate(
    currentId: string,
    next: Omit<RefreshTokenRecord, 'revokedAt' | 'replacedBy'>,
    now: Date,
  ): Promise<boolean>;
  /** Revoga todos os tokens ainda ativos da família. */
  revokeFamily(familyId: string, now: Date): Promise<void>;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  compare(plain: string, hash: string): Promise<boolean>;
}

export interface AccessTokenClaims {
  sub: string;
  email: string;
  name: string;
}

export interface SignedAccessToken {
  token: string;
  expiresIn: number;
}

export interface AccessTokenService {
  sign(claims: AccessTokenClaims): Promise<SignedAccessToken>;
  /** Lança InvalidSessionError se o token for inválido ou expirado. */
  verify(token: string): Promise<AccessTokenClaims>;
}

export interface OpaqueTokenGenerator {
  /** Token aleatório, seguro para URL/cookie. */
  generate(): string;
  /** Hash determinístico (sha256 hex) usado para buscar o token no banco. */
  hash(token: string): string;
  newId(): string;
}

export interface RateLimitStatus {
  blocked: boolean;
  retryAfterSeconds: number;
}

export interface LoginRateLimiter {
  status(key: string): Promise<RateLimitStatus>;
  registerFailure(key: string): Promise<void>;
  reset(key: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const USER_REPOSITORY = Symbol('UserRepository');
export const REFRESH_TOKEN_REPOSITORY = Symbol('RefreshTokenRepository');
export const PASSWORD_HASHER = Symbol('PasswordHasher');
export const ACCESS_TOKEN_SERVICE = Symbol('AccessTokenService');
export const OPAQUE_TOKEN_GENERATOR = Symbol('OpaqueTokenGenerator');
export const LOGIN_RATE_LIMITER = Symbol('LoginRateLimiter');
export const CLOCK = Symbol('Clock');
export const SESSION_SETTINGS = Symbol('SessionSettings');

export interface SessionSettings {
  refreshTokenTtlDays: number;
}
