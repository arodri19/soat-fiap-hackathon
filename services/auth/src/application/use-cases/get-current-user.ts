import { InvalidSessionError } from '../../domain/errors';
import { toPublicUser, type PublicUser } from '../../domain/user';
import type { UserRepository } from '../ports';

export class GetCurrentUser {
  constructor(private readonly users: UserRepository) {}

  async execute(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) throw new InvalidSessionError();
    return toPublicUser(user);
  }
}
