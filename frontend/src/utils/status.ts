import type { VideoStatus } from '@/api/types';

export const STATUS_INFO: Record<VideoStatus, { label: string; color: string; icon: string }> = {
  PENDING: { label: 'Na fila', color: 'secondary', icon: 'mdi-timer-sand' },
  PROCESSING: { label: 'Processando', color: 'warning', icon: 'mdi-cog-sync-outline' },
  DONE: { label: 'Concluído', color: 'success', icon: 'mdi-check-circle-outline' },
  FAILED: { label: 'Erro', color: 'error', icon: 'mdi-alert-circle-outline' },
};
