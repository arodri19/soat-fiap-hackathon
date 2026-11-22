import { onScopeDispose, watch, type Ref } from 'vue';

/**
 * Executa `task` a cada `intervalMs` enquanto `enabled` for true e a aba estiver visível.
 * Usado para atualizar o status dos vídeos sem recarregar a página.
 */
export function usePolling(task: () => unknown, intervalMs: number, enabled: Ref<boolean>) {
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    clearInterval(timer);
    timer = undefined;
  };
  const start = () => {
    if (timer || !enabled.value || document.visibilityState === 'hidden') return;
    timer = setInterval(() => void task(), intervalMs);
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') stop();
    else if (enabled.value) {
      void task(); // atualiza na hora ao voltar para a aba
      start();
    }
  };

  watch(enabled, (on) => (on ? start() : stop()), { immediate: true });
  document.addEventListener('visibilitychange', onVisibility);
  onScopeDispose(() => {
    stop();
    document.removeEventListener('visibilitychange', onVisibility);
  });

  return { stop };
}
