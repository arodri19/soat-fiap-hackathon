// Configuração em runtime. No container este arquivo é gerado a partir das
// variáveis de ambiente (docker/40-config.sh); aqui ficam os valores de desenvolvimento.
window.__APP_CONFIG__ = {
  apiBaseUrl: '/api',
  useMock: false,
  pollIntervalMs: 3000,
  maxUploadMb: 500,
  links: {
    grafana: 'http://localhost:3000',
    prometheus: 'http://localhost:9090',
    rabbitmq: 'http://localhost:15672',
    mailpit: 'http://localhost:8025',
    minio: 'http://localhost:9001',
  },
};
