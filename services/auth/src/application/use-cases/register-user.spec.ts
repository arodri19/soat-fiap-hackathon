import { EmailAlreadyRegisteredError, WeakPasswordError } from '../../domain/errors';
import { buildDeps } from '../testing/fakes';
import { RegisterUser } from './register-user';

describe('RegisterUser', () => {
  const setup = () => {
    const deps = buildDeps();
    return { ...deps, useCase: new RegisterUser(deps.users, deps.hasher) };
  };

  it('cria o usuário com e-mail normalizado, nome limpo e senha com hash', async () => {
    const { useCase, users } = setup();

    const user = await useCase.execute({
      name: '  Ana   Souza ',
      email: '  Ana@Exemplo.COM ',
      password: 'senhaForte1',
    });

    expect(user).toEqual({
      id: 'user-1',
      name: 'Ana Souza',
      email: 'ana@exemplo.com',
      createdAt: expect.any(Date),
    });
    expect(user).not.toHaveProperty('passwordHash');
    expect(users.users[0].passwordHash).toBe('hashed:senhaForte1');
  });

  it('recusa e-mail já cadastrado, ignorando maiúsculas', async () => {
    const { useCase } = setup();
    await useCase.execute({ name: 'Ana', email: 'ana@exemplo.com', password: 'senhaForte1' });

    await expect(
      useCase.execute({ name: 'Outra', email: 'ANA@exemplo.com', password: 'senhaForte2' }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it.each([
    ['curta', 'abc1'],
    ['sem número', 'somenteletras'],
    ['sem letra', '12345678'],
    ['acima de 72 bytes', `a1${'x'.repeat(71)}`],
  ])('recusa senha fraca (%s)', async (_caso, password) => {
    const { useCase, users } = setup();

    await expect(
      useCase.execute({ name: 'Ana', email: 'ana@exemplo.com', password }),
    ).rejects.toBeInstanceOf(WeakPasswordError);
    expect(users.users).toHaveLength(0);
  });
});
