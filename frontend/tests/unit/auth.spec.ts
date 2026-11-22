import { http as mswHttp, HttpResponse } from 'msw';
import { createPinia, setActivePinia } from 'pinia';
import { http, installAuthInterceptors } from '@/api/http';
import { useAuthStore } from '@/stores/auth';
import { server } from '../setup';

const user = {
  id: 'u1',
  name: 'Ana',
  email: 'ana@exemplo.com',
  created_at: '2026-11-22T10:00:00Z',
};
const session = (token: string) => ({
  access_token: token,
  token_type: 'Bearer',
  expires_in: 900,
  user,
});

describe('auth store + interceptors', () => {
  let uninstall: () => void;
  let expired: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    const auth = useAuthStore();
    expired = vi.fn();
    uninstall = installAuthInterceptors({
      getAccessToken: () => auth.accessToken,
      refresh: () => auth.refresh(),
      onSessionExpired: expired,
    });
  });
  afterEach(() => uninstall());

  it('login guarda usuário e token (só em memória)', async () => {
    server.use(mswHttp.post('*/api/auth/login', () => HttpResponse.json(session('t1'))));
    const auth = useAuthStore();

    await auth.login(' ana@exemplo.com ', 'senhaForte1');

    expect(auth.isAuthenticated).toBe(true);
    expect(auth.user?.name).toBe('Ana');
    expect(localStorage.length).toBe(0);
  });

  it('login com credenciais erradas propaga a mensagem da API', async () => {
    server.use(
      mswHttp.post('*/api/auth/login', () =>
        HttpResponse.json({ error: 'E-mail ou senha inválidos' }, { status: 401 }),
      ),
    );
    const { apiErrorMessage } = await import('@/api/http');
    const error = await useAuthStore()
      .login('ana@exemplo.com', 'errada')
      .catch((e: unknown) => e);
    expect(apiErrorMessage(error)).toBe('E-mail ou senha inválidos');
    expect(expired).not.toHaveBeenCalled();
  });

  it('cadastro cria a conta e já entra', async () => {
    const register = vi.fn();
    server.use(
      mswHttp.post('*/api/auth/register', async ({ request }) => {
        register(await request.json());
        return HttpResponse.json(user, { status: 201 });
      }),
      mswHttp.post('*/api/auth/login', () => HttpResponse.json(session('t1'))),
    );

    await useAuthStore().register(' Ana ', 'ana@exemplo.com', 'senhaForte1');

    expect(register).toHaveBeenCalledWith({
      name: 'Ana',
      email: 'ana@exemplo.com',
      password: 'senhaForte1',
    });
    expect(useAuthStore().isAuthenticated).toBe(true);
  });

  it('init restaura a sessão pelo cookie de refresh; sem sessão fica deslogado', async () => {
    server.use(mswHttp.post('*/api/auth/refresh', () => HttpResponse.json(session('restaurado'))));
    const auth = useAuthStore();
    await auth.init();
    expect(auth.accessToken).toBe('restaurado');
    expect(auth.ready).toBe(true);

    setActivePinia(createPinia());
    server.use(
      mswHttp.post('*/api/auth/refresh', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
    );
    const anon = useAuthStore();
    await anon.init();
    expect(anon.isAuthenticated).toBe(false);
    expect(anon.ready).toBe(true);
  });

  it('refresh é single-flight: chamadas simultâneas fazem uma única requisição', async () => {
    let calls = 0;
    server.use(
      mswHttp.post('*/api/auth/refresh', () => {
        calls++;
        return HttpResponse.json(session(`t${calls}`));
      }),
    );
    const auth = useAuthStore();

    const tokens = await Promise.all([auth.refresh(), auth.refresh(), auth.refresh()]);

    expect(calls).toBe(1);
    expect(new Set(tokens)).toEqual(new Set(['t1']));
  });

  it('401 numa chamada: renova o token e repete a requisição com o novo', async () => {
    const seen: (string | null)[] = [];
    server.use(
      mswHttp.post('*/api/auth/login', () => HttpResponse.json(session('velho'))),
      mswHttp.post('*/api/auth/refresh', () => HttpResponse.json(session('novo'))),
      mswHttp.get('*/api/videos', ({ request }) => {
        const auth = request.headers.get('Authorization');
        seen.push(auth);
        return auth === 'Bearer novo'
          ? HttpResponse.json({ ok: true })
          : HttpResponse.json({ error: 'expirado' }, { status: 401 });
      }),
    );
    await useAuthStore().login('ana@exemplo.com', 'senhaForte1');

    const res = await http.get('/videos');

    expect(res.data).toEqual({ ok: true });
    expect(seen).toEqual(['Bearer velho', 'Bearer novo']);
  });

  it('se não der para renovar, encerra a sessão e avisa', async () => {
    server.use(
      mswHttp.post('*/api/auth/login', () => HttpResponse.json(session('velho'))),
      mswHttp.post('*/api/auth/refresh', () => HttpResponse.json({ error: 'x' }, { status: 401 })),
      mswHttp.get('*/api/videos', () => HttpResponse.json({ error: 'expirado' }, { status: 401 })),
    );
    const auth = useAuthStore();
    await auth.login('ana@exemplo.com', 'senhaForte1');

    await expect(http.get('/videos')).rejects.toThrow();

    expect(expired).toHaveBeenCalledOnce();
    expect(auth.isAuthenticated).toBe(false);
  });

  it('logout limpa a sessão mesmo se a API falhar', async () => {
    server.use(
      mswHttp.post('*/api/auth/login', () => HttpResponse.json(session('t'))),
      mswHttp.post('*/api/auth/logout', () => HttpResponse.error()),
    );
    const auth = useAuthStore();
    await auth.login('ana@exemplo.com', 'senhaForte1');

    await auth.logout().catch(() => undefined);

    expect(auth.isAuthenticated).toBe(false);
    expect(auth.user).toBeNull();
  });
});
