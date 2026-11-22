import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthenticatedUser } from '../../application/ports';
import { UnauthorizedError } from '../../domain/errors';

export interface TokenVerifierSettings {
  jwksUrl: string;
  issuer: string;
  audience: string;
}

/**
 * Valida o access token emitido pelo auth-service localmente, com a chave pública
 * do JWKS (baixada uma vez e mantida em cache pelo jose). Não chama o auth a cada requisição.
 */
export class JwksTokenVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(private readonly settings: TokenVerifierSettings) {
    this.keys = createRemoteJWKSet(new URL(settings.jwksUrl), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
  }

  async verify(token: string): Promise<AuthenticatedUser> {
    try {
      const { payload } = await jwtVerify(token, this.keys, {
        algorithms: ['RS256'],
        issuer: this.settings.issuer,
        audience: this.settings.audience,
      });
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
        throw new UnauthorizedError();
      }
      return { id: payload.sub, email: payload.email };
    } catch {
      throw new UnauthorizedError();
    }
  }
}

export const TOKEN_VERIFIER = Symbol('TokenVerifier');

export type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(TOKEN_VERIFIER) private readonly verifier: JwksTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new UnauthorizedError();
    req.user = await this.verifier.verify(token);
    return true;
  }
}
