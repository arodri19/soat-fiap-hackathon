import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import {
  ACCESS_TOKEN_SERVICE,
  type AccessTokenClaims,
  type AccessTokenService,
} from '../../application/ports';
import { InvalidSessionError } from '../../domain/errors';

export type AuthenticatedRequest = Request & { auth: AccessTokenClaims };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(ACCESS_TOKEN_SERVICE) private readonly tokens: AccessTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw new InvalidSessionError();
    req.auth = await this.tokens.verify(token);
    return true;
  }
}
