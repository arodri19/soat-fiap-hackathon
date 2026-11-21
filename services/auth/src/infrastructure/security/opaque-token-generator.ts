import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { OpaqueTokenGenerator } from '../../application/ports';

/** Refresh tokens: 256 bits aleatórios em base64url; no banco fica só o sha256. */
export class CryptoOpaqueTokenGenerator implements OpaqueTokenGenerator {
  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  newId(): string {
    return randomUUID();
  }
}
