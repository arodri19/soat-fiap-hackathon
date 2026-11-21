import { InvalidSessionError } from '../../domain/errors';
import { refreshTokenState } from '../../domain/refresh-token';
import type { Clock, OpaqueTokenGenerator, RefreshTokenRepository, UserRepository } from '../ports';
import type { Session, SessionIssuer } from '../session-issuer';

/**
 * Troca um refresh token válido por um novo par (rotação).
 *
 * Detecção de reuso: se chegar um token que já foi rotacionado, alguém pode ter
 * copiado o token. A família inteira é revogada e o usuário precisa logar de novo.
 */
export class RefreshSession {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: OpaqueTokenGenerator,
    private readonly sessions: SessionIssuer,
    private readonly clock: Clock,
  ) {}

  async execute(refreshToken: string | undefined): Promise<Session> {
    if (!refreshToken) throw new InvalidSessionError();

    const now = this.clock.now();
    const current = await this.refreshTokens.findByHash(this.tokens.hash(refreshToken));
    if (!current) throw new InvalidSessionError();

    const state = refreshTokenState(current, now);
    if (state === 'revoked') {
      await this.refreshTokens.revokeFamily(current.familyId, now);
      throw new InvalidSessionError();
    }
    if (state === 'expired') throw new InvalidSessionError();

    const user = await this.users.findById(current.userId);
    if (!user) {
      await this.refreshTokens.revokeFamily(current.familyId, now);
      throw new InvalidSessionError();
    }

    const next = this.sessions.newRefreshToken(user.id, current.familyId);
    const rotated = await this.refreshTokens.rotate(current.id, next.record, now);
    if (!rotated) {
      // Outra requisição usou o mesmo token ao mesmo tempo: trata como reuso.
      await this.refreshTokens.revokeFamily(current.familyId, now);
      throw new InvalidSessionError();
    }

    return this.sessions.build(user, next);
  }
}
