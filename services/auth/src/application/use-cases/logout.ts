import type { Clock, OpaqueTokenGenerator, RefreshTokenRepository } from '../ports';

/** Encerra a sessão (família do refresh token). Idempotente: token ausente ou desconhecido não é erro. */
export class Logout {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokens: OpaqueTokenGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const current = await this.refreshTokens.findByHash(this.tokens.hash(refreshToken));
    if (!current) return;
    await this.refreshTokens.revokeFamily(current.familyId, this.clock.now());
  }
}
