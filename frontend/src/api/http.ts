import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { config } from '@/config';
import type { ApiErrorBody } from './types';

/** Cliente HTTP da API (mesma origem via gateway: o cookie de refresh vai junto). */
export const http = axios.create({
  baseURL: config.apiBaseUrl,
  withCredentials: true,
  timeout: 30_000,
});

export interface AuthHooks {
  getAccessToken(): string | null;
  /** Renova a sessão e devolve o novo access token (lança se não der). */
  refresh(): Promise<string>;
  /** Chamado quando a sessão não pode ser renovada. */
  onSessionExpired(): void;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/** Rotas de sessão: não levam Bearer nem disparam refresh automático. */
const isAuthRoute = (url = '') => /\/auth\/(login|register|refresh|logout)$/.test(url);

/**
 * Anexa o access token e, em 401, renova a sessão uma vez e repete a requisição.
 * O refresh é "single-flight" (ver stores/auth): requisições concorrentes esperam a mesma renovação.
 */
export function installAuthInterceptors(hooks: AuthHooks): () => void {
  const req = http.interceptors.request.use((cfg) => {
    const token = hooks.getAccessToken();
    if (token && !isAuthRoute(cfg.url)) cfg.headers.set('Authorization', `Bearer ${token}`);
    return cfg;
  });

  const res = http.interceptors.response.use(undefined, async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    if (
      error.response?.status !== 401 ||
      !original ||
      original._retried ||
      isAuthRoute(original.url)
    ) {
      throw error;
    }
    original._retried = true;
    let token: string;
    try {
      token = await hooks.refresh();
    } catch {
      hooks.onSessionExpired();
      throw error;
    }
    original.headers.set('Authorization', `Bearer ${token}`);
    return http(original);
  });

  return () => {
    http.interceptors.request.eject(req);
    http.interceptors.response.eject(res);
  };
}

/** Mensagem amigável a partir do erro da API (`{ error, details }`) ou da rede. */
export function apiErrorMessage(
  error: unknown,
  fallback = 'Algo deu errado. Tente novamente.',
): string {
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    if (!error.response) return 'Não foi possível conectar ao servidor.';
    const body = error.response.data;
    if (body?.details?.length) return body.details.map((d) => d.message).join(' · ');
    if (body?.error) return body.error;
    if (error.response.status === 413) return 'Arquivo grande demais.';
  }
  return fallback;
}
