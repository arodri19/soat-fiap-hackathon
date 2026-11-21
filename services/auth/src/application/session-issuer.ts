import { toPublicUser, type PublicUser, type User } from '../domain/user';
import type {
  AccessTokenService,
  Clock,
  OpaqueTokenGenerator,
  RefreshTokenRepository,
  SessionSettings,
} from './ports';

export interface Session {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: PublicUser;
}

export interface NewRefreshToken {
  id: string;
  token: string;
  record: {
    id: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
  };
}

/** Monta access token + refresh token. Usado no login e na renovação. */
export class SessionIssuer {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: OpaqueTokenGenerator,
    private readonly clock: Clock,
    private readonly settings: SessionSettings,
  ) {}

  /** Novo login: cria uma família nova de refresh tokens. */
  async start(user: User): Promise<Session> {
    const refresh = this.newRefreshToken(user.id, this.tokens.newId());
    await this.refreshTokens.create(refresh.record);
    return this.build(user, refresh);
  }

  newRefreshToken(userId: string, familyId: string): NewRefreshToken {
    const id = this.tokens.newId();
    const token = this.tokens.generate();
    const expiresAt = new Date(
      this.clock.now().getTime() + this.settings.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
    );
    return {
      id,
      token,
      record: { id, userId, familyId, tokenHash: this.tokens.hash(token), expiresAt },
    };
  }

  async build(user: User, refresh: NewRefreshToken): Promise<Session> {
    const access = await this.accessTokens.sign({
      sub: user.id,
      email: user.email,
      name: user.name,
    });
    return {
      accessToken: access.token,
      expiresIn: access.expiresIn,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.record.expiresAt,
      user: toPublicUser(user),
    };
  }
}
