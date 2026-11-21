import bcrypt from 'bcryptjs';
import type { PasswordHasher } from '../../application/ports';

export class BcryptPasswordHasher implements PasswordHasher {
  constructor(private readonly cost: number) {}

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.cost);
  }

  compare(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
