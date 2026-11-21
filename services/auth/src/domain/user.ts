import { WeakPasswordError } from './errors';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

/** Dados do usuário que podem sair do serviço (nunca o hash da senha). */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export const PASSWORD_MIN_LENGTH = 8;
/** bcrypt ignora o que passa de 72 bytes; recusamos em vez de truncar em silêncio. */
export const PASSWORD_MAX_BYTES = 72;

/**
 * Regra de senha: mínimo 8 caracteres, ao menos uma letra e um número, até 72 bytes.
 * Lança WeakPasswordError com o motivo legível.
 */
export function assertPasswordPolicy(password: string): void {
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new WeakPasswordError(`A senha deve ter no mínimo ${PASSWORD_MIN_LENGTH} caracteres`);
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    throw new WeakPasswordError(`A senha deve ter no máximo ${PASSWORD_MAX_BYTES} bytes`);
  }
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
    throw new WeakPasswordError('A senha deve conter ao menos uma letra e um número');
  }
}
