import type { PoolClient } from 'pg';
import type { RefreshTokenRepository } from '../../application/ports';
import type { RefreshTokenRecord } from '../../domain/refresh-token';
import type { Database } from './database';

type NewRecord = Omit<RefreshTokenRecord, 'revokedAt' | 'replacedBy'>;

interface RefreshTokenRow {
  id: string;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
}

const INSERT = `INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, expires_at)
                VALUES ($1, $2, $3, $4, $5)`;

const insertParams = (r: NewRecord) => [r.id, r.userId, r.familyId, r.tokenHash, r.expiresAt];

export class PgRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: Database) {}

  async create(record: NewRecord): Promise<void> {
    await this.db.pool.query(INSERT, insertParams(record));
  }

  async findByHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    const { rows } = await this.db.pool.query<RefreshTokenRow>(
      `SELECT id, user_id, family_id, token_hash, expires_at, revoked_at, replaced_by
         FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      familyId: row.family_id,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      replacedBy: row.replaced_by,
    };
  }

  async rotate(currentId: string, next: NewRecord, now: Date): Promise<boolean> {
    return this.db.transaction(async (client: PoolClient) => {
      // "revoked_at IS NULL" torna a rotação atômica: só uma requisição concorrente vence.
      const { rowCount } = await client.query(
        `UPDATE refresh_tokens SET revoked_at = $2, replaced_by = $3
          WHERE id = $1 AND revoked_at IS NULL`,
        [currentId, now, next.id],
      );
      if (rowCount === 0) return false;
      await client.query(INSERT, insertParams(next));
      return true;
    });
  }

  async revokeFamily(familyId: string, now: Date): Promise<void> {
    await this.db.pool.query(
      `UPDATE refresh_tokens SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId, now],
    );
  }
}
