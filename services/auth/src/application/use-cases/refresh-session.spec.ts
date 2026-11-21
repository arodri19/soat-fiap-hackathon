import { InvalidSessionError } from '../../domain/errors';
import { buildDeps } from '../testing/fakes';
import { GetCurrentUser } from './get-current-user';
import { Login } from './login';
import { Logout } from './logout';
import { RefreshSession } from './refresh-session';
import { RegisterUser } from './register-user';

describe('Sessão: RefreshSession, Logout e GetCurrentUser', () => {
  const setup = async () => {
    const deps = buildDeps();
    await new RegisterUser(deps.users, deps.hasher).execute({
      name: 'Ana',
      email: 'ana@exemplo.com',
      password: 'senhaForte1',
    });
    const login = new Login(deps.users, deps.hasher, deps.rateLimiter, deps.sessions);
    const session = await login.execute({
      email: 'ana@exemplo.com',
      password: 'senhaForte1',
      ip: '10.0.0.1',
    });
    return {
      ...deps,
      session,
      refresh: new RefreshSession(
        deps.users,
        deps.refreshTokens,
        deps.tokens,
        deps.sessions,
        deps.clock,
      ),
      logout: new Logout(deps.refreshTokens, deps.tokens, deps.clock),
      me: new GetCurrentUser(deps.users),
    };
  };

  describe('RefreshSession', () => {
    it('rotaciona: novo refresh token na mesma família e o antigo fica revogado', async () => {
      const { refresh, session, refreshTokens } = await setup();
      const [original] = refreshTokens.records;

      const renewed = await refresh.execute(session.refreshToken);

      expect(renewed.refreshToken).not.toBe(session.refreshToken);
      expect(renewed.accessToken).toBe('access:user-1');
      const next = refreshTokens.records[1];
      expect(next.familyId).toBe(original.familyId);
      expect(original.revokedAt).not.toBeNull();
      expect(original.replacedBy).toBe(next.id);
    });

    it('reuso de token já rotacionado revoga a família inteira', async () => {
      const { refresh, session, refreshTokens } = await setup();
      const renewed = await refresh.execute(session.refreshToken);

      await expect(refresh.execute(session.refreshToken)).rejects.toBeInstanceOf(
        InvalidSessionError,
      );
      // O token legítimo mais novo também deixa de valer
      await expect(refresh.execute(renewed.refreshToken)).rejects.toBeInstanceOf(
        InvalidSessionError,
      );
      expect(refreshTokens.records.every((r) => r.revokedAt)).toBe(true);
    });

    it('recusa token ausente, desconhecido ou expirado', async () => {
      const { refresh, session, clock } = await setup();

      await expect(refresh.execute(undefined)).rejects.toBeInstanceOf(InvalidSessionError);
      await expect(refresh.execute('inventado')).rejects.toBeInstanceOf(InvalidSessionError);

      clock.advanceDays(8);
      await expect(refresh.execute(session.refreshToken)).rejects.toBeInstanceOf(
        InvalidSessionError,
      );
    });

    it('recusa e revoga a família se o usuário não existe mais', async () => {
      const { refresh, session, users, refreshTokens } = await setup();
      users.users.length = 0;

      await expect(refresh.execute(session.refreshToken)).rejects.toBeInstanceOf(
        InvalidSessionError,
      );
      expect(refreshTokens.records[0].revokedAt).not.toBeNull();
    });

    it('rotação concorrente perdida é tratada como reuso', async () => {
      const { refresh, session, refreshTokens } = await setup();
      jest.spyOn(refreshTokens, 'rotate').mockResolvedValueOnce(false);

      await expect(refresh.execute(session.refreshToken)).rejects.toBeInstanceOf(
        InvalidSessionError,
      );
      expect(refreshTokens.records[0].revokedAt).not.toBeNull();
    });
  });

  describe('Logout', () => {
    it('revoga a sessão e o refresh token deixa de funcionar', async () => {
      const { logout, refresh, session } = await setup();

      await logout.execute(session.refreshToken);

      await expect(refresh.execute(session.refreshToken)).rejects.toBeInstanceOf(
        InvalidSessionError,
      );
    });

    it('é idempotente: sem token ou com token desconhecido não falha', async () => {
      const { logout } = await setup();
      await expect(logout.execute(undefined)).resolves.toBeUndefined();
      await expect(logout.execute('desconhecido')).resolves.toBeUndefined();
    });
  });

  describe('GetCurrentUser', () => {
    it('devolve os dados públicos do usuário', async () => {
      const { me } = await setup();
      await expect(me.execute('user-1')).resolves.toMatchObject({
        id: 'user-1',
        email: 'ana@exemplo.com',
      });
    });

    it('usuário removido invalida a sessão', async () => {
      const { me } = await setup();
      await expect(me.execute('user-999')).rejects.toBeInstanceOf(InvalidSessionError);
    });
  });
});
