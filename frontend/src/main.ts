import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { installAuthInterceptors } from './api/http';
import { config } from './config';
import { vuetify } from './plugins/vuetify';
import { router } from './router';
import { useAuthStore } from './stores/auth';
import { useNotifyStore } from './stores/notify';

async function bootstrap() {
  // Modo demonstração: a API é simulada no navegador (MSW), sem backend
  if (config.useMock) {
    const { worker } = await import('./mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
  }

  const app = createApp(App);
  const pinia = createPinia();
  app.use(pinia);

  const auth = useAuthStore();
  installAuthInterceptors({
    getAccessToken: () => auth.accessToken,
    refresh: () => auth.refresh(),
    onSessionExpired: () => {
      auth.clear();
      useNotifyStore().push('Sua sessão expirou. Entre novamente.', 'warning');
      void router.push({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
    },
  });

  app.use(router).use(vuetify).mount('#app');
}

void bootstrap();
