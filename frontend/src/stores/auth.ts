import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '@/api/auth';
import type { LoginResponse, User } from '@/api/types';

/**
 * Sessão do usuário.
 *  - access token só em memória (nunca em localStorage: não fica exposto a XSS persistente);
 *  - refresh token em cookie HttpOnly, gerenciado pelo auth-service;
 *  - ao abrir/recarregar a página, `init()` tenta renovar a sessão pelo cookie.
 */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const accessToken = ref<string | null>(null);
  const ready = ref(false);
  let refreshing: Promise<string> | null = null;

  const isAuthenticated = computed(() => !!accessToken.value);

  function setSession(data: LoginResponse) {
    accessToken.value = data.access_token;
    user.value = data.user;
  }

  function clear() {
    accessToken.value = null;
    user.value = null;
  }

  /** Renova a sessão. Chamadas simultâneas compartilham a mesma requisição (single-flight). */
  function refresh(): Promise<string> {
    refreshing ??= authApi
      .refresh()
      .then((data) => {
        setSession(data);
        return data.access_token;
      })
      .catch((error: unknown) => {
        clear();
        throw error;
      })
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function init() {
    if (ready.value) return;
    try {
      await refresh();
    } catch {
      /* sem sessão: fica deslogado */
    } finally {
      ready.value = true;
    }
  }

  async function login(email: string, password: string) {
    setSession(await authApi.login(email.trim(), password));
  }

  async function register(name: string, email: string, password: string) {
    await authApi.register(name.trim(), email.trim(), password);
    await login(email, password);
  }

  async function logout() {
    try {
      await authApi.logout();
    } finally {
      clear();
    }
  }

  return {
    user,
    accessToken,
    ready,
    isAuthenticated,
    init,
    login,
    register,
    logout,
    refresh,
    clear,
  };
});
