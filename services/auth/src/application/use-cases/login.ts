import { InvalidCredentialsError, TooManyLoginAttemptsError } from '../../domain/errors';
import { normalizeEmail } from '../../domain/user';
import type { LoginRateLimiter, PasswordHasher, UserRepository } from '../ports';
import type { Session, SessionIssuer } from '../session-issuer';

export interface LoginInput {
  email: string;
  password: string;
  /** IP do cliente, compõe a chave do rate limit junto com o e-mail. */
  ip: string;
}

/**
 * Hash bcrypt válido (de uma senha aleatória) comparado quando o e-mail não existe,
 * para que a resposta leve o mesmo tempo e não revele quais e-mails estão cadastrados.
 */
const DUMMY_HASH = '$2b$12$7IiYjRifyj0Sz30lHB5ZEe4Fg0ojr3Zg1sZmQ8Ql56FFddU.9hgu.';

export class Login {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly rateLimiter: LoginRateLimiter,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(input: LoginInput): Promise<Session> {
    const email = normalizeEmail(input.email);
    const key = `${email}|${input.ip}`;

    const limit = await this.rateLimiter.status(key);
    if (limit.blocked) {
      throw new TooManyLoginAttemptsError(limit.retryAfterSeconds);
    }

    const user = await this.users.findByEmail(email);
    const passwordOk = await this.hasher.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !passwordOk) {
      await this.rateLimiter.registerFailure(key);
      throw new InvalidCredentialsError();
    }

    await this.rateLimiter.reset(key);
    return this.sessions.start(user);
  }
}
