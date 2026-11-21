import {
  calculateJwkThumbprint,
  exportJWK,
  generateKeyPair,
  importPKCS8,
  importSPKI,
  jwtVerify,
  SignJWT,
  type JWK,
  type KeyLike,
} from 'jose';
import { createPublicKey } from 'node:crypto';
import type {
  AccessTokenClaims,
  AccessTokenService,
  SignedAccessToken,
} from '../../application/ports';
import { InvalidSessionError } from '../../domain/errors';

const ALG = 'RS256';

export interface AccessTokenSettings {
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

/**
 * Emite e valida o access token (JWT RS256). A chave pública é publicada em
 * /.well-known/jwks.json para os outros serviços validarem sem chamar o auth.
 */
export class JoseAccessTokenService implements AccessTokenService {
  private constructor(
    private readonly privateKey: KeyLike,
    private readonly publicKey: KeyLike,
    private readonly publicJwk: JWK,
    private readonly settings: AccessTokenSettings,
  ) {}

  /** Usa a chave PEM (PKCS#8) informada ou, sem ela, gera uma chave temporária. */
  static async create(
    settings: AccessTokenSettings,
    privateKeyPem?: string,
  ): Promise<JoseAccessTokenService> {
    let privateKey: KeyLike;
    let publicKey: KeyLike;

    if (privateKeyPem) {
      privateKey = await importPKCS8(privateKeyPem, ALG, { extractable: true });
      const spki = createPublicKey(privateKeyPem)
        .export({ type: 'spki', format: 'pem' })
        .toString();
      publicKey = await importSPKI(spki, ALG, { extractable: true });
    } else {
      ({ privateKey, publicKey } = await generateKeyPair(ALG, {
        modulusLength: 2048,
        extractable: true,
      }));
    }

    const jwk = await exportJWK(publicKey);
    const kid = await calculateJwkThumbprint(jwk);
    const publicJwk: JWK = { ...jwk, kid, alg: ALG, use: 'sig' };
    return new JoseAccessTokenService(privateKey, publicKey, publicJwk, settings);
  }

  get keyId(): string {
    return this.publicJwk.kid as string;
  }

  jwks(): { keys: JWK[] } {
    return { keys: [this.publicJwk] };
  }

  async sign(claims: AccessTokenClaims): Promise<SignedAccessToken> {
    const token = await new SignJWT({ email: claims.email, name: claims.name })
      .setProtectedHeader({ alg: ALG, kid: this.keyId, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.settings.issuer)
      .setAudience(this.settings.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.settings.ttlSeconds}s`)
      .sign(this.privateKey);
    return { token, expiresIn: this.settings.ttlSeconds };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: [ALG],
        issuer: this.settings.issuer,
        audience: this.settings.audience,
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string' ||
        typeof payload.name !== 'string'
      ) {
        throw new InvalidSessionError();
      }
      return { sub: payload.sub, email: payload.email, name: payload.name };
    } catch {
      throw new InvalidSessionError();
    }
  }
}
