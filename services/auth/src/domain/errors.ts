/**
 * Erros de domínio. Não dependem de HTTP: o mapeamento para status code fica
 * no filtro de exceções da camada de infraestrutura.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class EmailAlreadyRegisteredError extends DomainError {
  readonly code = 'EMAIL_ALREADY_REGISTERED';
  constructor() {
    super('E-mail já cadastrado');
  }
}

export class WeakPasswordError extends DomainError {
  readonly code = 'WEAK_PASSWORD';
  constructor(reason: string) {
    super(reason);
  }
}

/** Mensagem genérica de propósito: não revela se o e-mail existe. */
export class InvalidCredentialsError extends DomainError {
  readonly code = 'INVALID_CREDENTIALS';
  constructor() {
    super('E-mail ou senha inválidos');
  }
}

export class InvalidSessionError extends DomainError {
  readonly code = 'INVALID_SESSION';
  constructor() {
    super('Sessão inválida ou expirada');
  }
}

export class TooManyLoginAttemptsError extends DomainError {
  readonly code = 'TOO_MANY_LOGIN_ATTEMPTS';
  constructor(readonly retryAfterSeconds: number) {
    super('Muitas tentativas de login. Tente novamente mais tarde.');
  }
}
