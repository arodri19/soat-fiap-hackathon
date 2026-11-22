import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface Toast {
  id: number;
  text: string;
  color: 'success' | 'error' | 'info' | 'warning';
}

/** Avisos globais (snackbar). */
export const useNotifyStore = defineStore('notify', () => {
  const toasts = ref<Toast[]>([]);
  let seq = 0;

  function push(text: string, color: Toast['color'] = 'info') {
    toasts.value.push({ id: ++seq, text, color });
  }

  function dismiss(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return {
    toasts,
    push,
    dismiss,
    success: (t: string) => push(t, 'success'),
    error: (t: string) => push(t, 'error'),
  };
});
