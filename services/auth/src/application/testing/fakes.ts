/* Dublês em memória das portas, usados nos testes unitários dos casos de uso. */
import type {
  AccessTokenClaims,
  AccessTokenService,
  Clock,
  LoginRateLimiter,
  NewUser,
  OpaqueTokenGenerator,
  PasswordHasher,
  RateLimitStatus,
  RefreshTokenRepository,
  SignedAccessToken,
  UserRepository,
} from '../ports';
import { EmailAlreadyRegisteredError, InvalidSessionError } from '../../domain/errors';
import type { RefreshTokenRecord } from '../../domain/refresh-token';
import type { User } from '../../domain/user';
import { SessionIssuer } from '../session-issuer';

export class InMemoryUserRepository implements UserRepository {
  readonly users: User[] = [];
  private seq = 0;

  async findByEmail(email: string) {
    return this.users.find((u) => u.email === email) ?? null;
  }

  async findById(id: string) {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async create(data: NewUser) {
    if (this.users.some((u) => u.email === data.email)) throw new EmailAlreadyRegisteredError();
    const user: User = { id: `user-${++this.seq}`, createdAt: new Date('2026-01-01'), ...data };
    this.users.push(user);
    return user;
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  readonly records: RefreshTokenRecord[] = [];

  async create(record: Omit<RefreshTokenRecord, 'revokedAt' | 'replacedBy'>) {
    this.records.push({ ...record, revokedAt: null, replacedBy: null });
  }

  async findByHash(tokenHash: string) {
    return this.records.find((r) => r.tokenHash === tokenHash) ?? null;
  }

  async rotate(
    currentId: string,
    next: Omit<RefreshTokenRecord, 'revokedAt' | 'replacedBy'>,
    now: Date,
  ) {
    const current = this.records.find((r) => r.id === currentId);
    if (!current || current.revokedAt) return false;
    current.revokedAt = now;
    current.replacedBy = next.id;
    await this.create(next);
    return true;
  }

  async revokeFamily(familyId: string, now: Date) {
    for (const r of this.records) {
      if (r.familyId === familyId && !r.revokedAt) r.revokedAt = now;
    }
  }

  byId(id: string) {
    return this.records.find((r) => r.id === id);
  }
}

/** "Hash" reversível e previsível: suficiente para testar a lógica dos casos de uso. */
export class FakePasswordHasher implements PasswordHasher {
  compareCalls = 0;

  async hash(plain: string) {
    return `hashed:${plain}`;
  }

  async compare(plain: string, hash: string) {
    this.compareCalls++;
    return hash === `hashed:${plain}`;
  }
}

export class FakeAccessTokenService implements AccessTokenService {
  async sign(claims: AccessTokenClaims): Promise<SignedAccessToken> {
    return { token: `access:${claims.sub}`, expiresIn: 900 };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    if (!token.startsWith('access:')) throw new InvalidSessionError();
    const sub = token.slice('access:'.length);
    return { sub, email: `${sub}@test`, name: sub };
  }
}

export class SequentialTokenGenerator implements OpaqueTokenGenerator {
  private seq = 0;

  generate() {
    return `token-${++this.seq}`;
  }

  hash(token: string) {
    return `h(${token})`;
  }

  newId() {
    return `id-${++this.seq}`;
  }
}

export class FakeRateLimiter implements LoginRateLimiter {
  readonly failures = new Map<string, number>();

  constructor(private readonly max = 5) {}

  async status(key: string): Promise<RateLimitStatus> {
    const blocked = (this.failures.get(key) ?? 0) >= this.max;
    return { blocked, retryAfterSeconds: blocked ? 60 : 0 };
  }

  async registerFailure(key: string) {
    this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
  }

  async reset(key: string) {
    this.failures.delete(key);
  }
}

export class FixedClock implements Clock {
  constructor(public current = new Date('2026-11-21T12:00:00Z')) {}

  now() {
    return this.current;
  }

  advanceDays(days: number) {
    this.current = new Date(this.current.getTime() + days * 86_400_000);
  }
}

export function buildDeps() {
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const hasher = new FakePasswordHasher();
  const accessTokens = new FakeAccessTokenService();
  const tokens = new SequentialTokenGenerator();
  const rateLimiter = new FakeRateLimiter();
  const clock = new FixedClock();
  const sessions = new SessionIssuer(accessTokens, refreshTokens, tokens, clock, {
    refreshTokenTtlDays: 7,
  });
  return { users, refreshTokens, hasher, accessTokens, tokens, rateLimiter, clock, sessions };
}
