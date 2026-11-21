import { EmailAlreadyRegisteredError } from '../../domain/errors';
import {
  assertPasswordPolicy,
  normalizeEmail,
  normalizeName,
  toPublicUser,
  type PublicUser,
} from '../../domain/user';
import type { PasswordHasher, UserRepository } from '../ports';

export interface RegisterUserInput {
  name: string;
  email: string;
  password: string;
}

export class RegisterUser {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: RegisterUserInput): Promise<PublicUser> {
    assertPasswordPolicy(input.password);
    const email = normalizeEmail(input.email);

    if (await this.users.findByEmail(email)) {
      throw new EmailAlreadyRegisteredError();
    }

    const user = await this.users.create({
      name: normalizeName(input.name),
      email,
      passwordHash: await this.hasher.hash(input.password),
    });
    return toPublicUser(user);
  }
}
