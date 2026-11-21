import { InvalidCredentialsError, TooManyLoginAttemptsError } from '../../domain/errors';
import { buildDeps } from '../testing/fakes';
import { Login } from './login';
import { RegisterUser } from './register-user';

describe('Login', () => {
  const setup = async () => {
    const deps = buildDeps();
    await new RegisterUser(deps.users, deps.hasher).execute({
      name: 'Ana',
      email: 'ana@exemplo.com',
      password: 'senhaForte1',
    });
    const useCase = new Login(deps.users, deps.hasher, deps.rateLimiter, deps.sessions);
    return { ...deps, useCase };
  };

  it('autentica e devolve access token, refresh token e usuário', async () => {
    const { useCase, refreshTokens } = await setup();

    const session = await useCase.execute({
      email: ' ANA@exemplo.com ',
      password: 'senhaForte1',
      ip: '10.0.0.1',
    });

    expect(session.accessToken).toBe('access:user-1');
    expect(session.expiresIn).toBe(900);
    expect(session.user.email).toBe('ana@exemplo.com');
    expect(session.refreshToken).toMatch(/^token-/);
    // No banco fica só o hash do refresh token, com validade de 7 dias
    expect(refreshTokens.records).toHaveLength(1);
    expect(refreshTokens.records[0].tokenHash).toBe(`h(${session.refreshToken})`);
    expect(session.refreshTokenExpiresAt.toISOString()).toBe('2026-11-28T12:00:00.000Z');
  });

  it('recusa senha errada com mensagem genérica e conta a falha', async () => {
    const { useCase, rateLimiter } = await setup();

    await expect(
      useCase.execute({ email: 'ana@exemplo.com', password: 'errada123', ip: '10.0.0.1' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(rateLimiter.failures.get('ana@exemplo.com|10.0.0.1')).toBe(1);
  });

  it('e-mail inexistente também compara um hash (tempo constante) e falha igual', async () => {
    const { useCase, hasher } = await setup();

    await expect(
      useCase.execute({ email: 'nao@existe.com', password: 'qualquer1', ip: '10.0.0.1' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(hasher.compareCalls).toBe(1);
  });

  it('bloqueia após 5 falhas, mesmo com a senha certa', async () => {
    const { useCase } = await setup();
    const attempt = (password: string) =>
      useCase.execute({ email: 'ana@exemplo.com', password, ip: '10.0.0.1' });

    for (let i = 0; i < 5; i++) {
      await expect(attempt('errada123')).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    const blocked = attempt('senhaForte1');
    await expect(blocked).rejects.toBeInstanceOf(TooManyLoginAttemptsError);
    await expect(blocked).rejects.toMatchObject({ retryAfterSeconds: 60 });
  });

  it('o bloqueio é por e-mail + IP: outro IP continua podendo entrar', async () => {
    const { useCase } = await setup();
    for (let i = 0; i < 5; i++) {
      await useCase
        .execute({ email: 'ana@exemplo.com', password: 'errada123', ip: '10.0.0.1' })
        .catch(() => undefined);
    }

    await expect(
      useCase.execute({ email: 'ana@exemplo.com', password: 'senhaForte1', ip: '10.0.0.2' }),
    ).resolves.toHaveProperty('accessToken');
  });

  it('login bem-sucedido zera o contador de falhas', async () => {
    const { useCase, rateLimiter } = await setup();
    await useCase
      .execute({ email: 'ana@exemplo.com', password: 'errada123', ip: '10.0.0.1' })
      .catch(() => undefined);

    await useCase.execute({ email: 'ana@exemplo.com', password: 'senhaForte1', ip: '10.0.0.1' });

    expect(rateLimiter.failures.has('ana@exemplo.com|10.0.0.1')).toBe(false);
  });
});
