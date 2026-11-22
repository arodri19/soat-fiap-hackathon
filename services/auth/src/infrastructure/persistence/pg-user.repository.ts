import type { NewUser, UserRepository } from '../../application/ports';
import { EmailAlreadyRegisteredError } from '../../domain/errors';
import type { User } from '../../domain/user';
import { isUniqueViolation, type Database } from './database';

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

const COLUMNS = 'id, name, email, password_hash, created_at';

const toDomain = (row: UserRow): User => ({
  id: row.id,
  name: row.name,
  email: row.email,
  passwordHash: row.password_hash,
  createdAt: row.created_at,
});

export class PgUserRepository implements UserRepository {
  constructor(private readonly db: Database) {}

  async findByEmail(email: string): Promise<User | null> {
    const { rows } = await this.db.pool.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE email = $1`,
      [email],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.db.pool.query<UserRow>(
      `SELECT ${COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async create(data: NewUser): Promise<User> {
    try {
      const { rows } = await this.db.pool.query<UserRow>(
        `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
        [data.name, data.email, data.passwordHash],
      );
      return toDomain(rows[0]);
    } catch (error) {
      // Dois cadastros simultâneos com o mesmo e-mail: o índice único decide.
      if (isUniqueViolation(error)) throw new EmailAlreadyRegisteredError();
      throw error;
    }
  }
}
