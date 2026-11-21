import { Pool, type PoolClient } from 'pg';

/** Pool de conexões do PostgreSQL (auth_db). */
export class Database {
  readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
  }

  /** Executa `work` numa transação; faz rollback se lançar. */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Código do PostgreSQL para violação de UNIQUE. */
export const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNIQUE_VIOLATION;
}
