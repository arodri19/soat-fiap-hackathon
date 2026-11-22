import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';

/** Pasta com os arquivos NNN_nome.sql, aplicados em ordem alfabética. */
export const MIGRATIONS_DIR = resolve(__dirname, '../../../migrations');

/** Chave fixa do advisory lock: garante que só uma réplica migra por vez. */
const LOCK_KEY = 727_002;

export interface MigrationResult {
  applied: string[];
}

/**
 * Executor de migrations simples e idempotente: registra o que já rodou em
 * `schema_migrations` e aplica cada arquivo novo dentro de uma transação.
 */
export async function runMigrations(pool: Pool, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const files = (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));

    for (const file of files.filter((f) => !done.has(f))) {
      const sql = await readFile(join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Falha na migration ${file}: ${(error as Error).message}`);
      }
    }
    return { applied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}

/* Uso direto: `npm run migrate` (lê DATABASE_URL). */
if (require.main === module) {
  void (async () => {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const { applied } = await runMigrations(pool);
      process.stdout.write(
        applied.length ? `Migrations aplicadas: ${applied.join(', ')}\n` : 'Banco já atualizado\n',
      );
    } finally {
      await pool.end();
    }
  })().catch((error: Error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
