export interface InfraLinks {
  grafana?: string;
  prometheus?: string;
  rabbitmq?: string;
  mailpit?: string;
  minio?: string;
}

export interface AppConfig {
  apiBaseUrl: string;
  /** Usa a API simulada (MSW) em vez do backend real. */
  useMock: boolean;
  pollIntervalMs: number;
  maxUploadMb: number;
  links: InfraLinks;
}

declare global {
  interface Window {
    __APP_CONFIG__?: Partial<AppConfig>;
  }
}

/** Mescla a configuração de runtime (public/config.js) com as variáveis do Vite. */
export function loadConfig(runtime: Partial<AppConfig> = window.__APP_CONFIG__ ?? {}): AppConfig {
  return {
    apiBaseUrl: runtime.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '/api',
    useMock: runtime.useMock ?? import.meta.env.VITE_USE_MOCK === 'true',
    pollIntervalMs: runtime.pollIntervalMs ?? 3000,
    maxUploadMb: runtime.maxUploadMb ?? 500,
    links: runtime.links ?? {},
  };
}

export const config = loadConfig();
