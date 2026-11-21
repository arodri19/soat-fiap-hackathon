export interface RefreshTokenRecord {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

export type RefreshTokenState = 'active' | 'expired' | 'revoked';

export function refreshTokenState(record: RefreshTokenRecord, now: Date): RefreshTokenState {
  if (record.revokedAt) return 'revoked';
  if (record.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'active';
}
