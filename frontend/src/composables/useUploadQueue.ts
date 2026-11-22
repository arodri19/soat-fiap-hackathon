import { reactive } from 'vue';
import { apiErrorMessage } from '@/api/http';
import { videosApi } from '@/api/videos';
import { validateVideoFile } from '@/utils/validation';

export type UploadState = 'uploading' | 'done' | 'error';

export interface UploadItem {
  id: number;
  name: string;
  size: number;
  progress: number; // 0–100
  state: UploadState;
  error?: string;
}

/**
 * Fila de uploads: valida cada arquivo e envia todos em paralelo (até `concurrency`
 * por vez), com progresso individual. Cada vídeo vira uma requisição — a API só
 * grava e enfileira; quem processa em paralelo são os workers.
 */
export function useUploadQueue(options: {
  maxMb: number;
  concurrency?: number;
  onUploaded?: () => void;
}) {
  const items = reactive<UploadItem[]>([]);
  let seq = 0;

  async function uploadOne(file: File, item: UploadItem) {
    try {
      await videosApi.upload(file, (f) => (item.progress = Math.round(f * 100)));
      item.progress = 100;
      item.state = 'done';
      options.onUploaded?.();
    } catch (e) {
      item.state = 'error';
      item.error = apiErrorMessage(e, 'Falha no envio');
    }
  }

  async function add(files: File[] | FileList) {
    const valid: [File, UploadItem][] = [];
    for (const file of Array.from(files)) {
      const problem = validateVideoFile(file, options.maxMb);
      const item = reactive<UploadItem>({
        id: ++seq,
        name: file.name,
        size: file.size,
        progress: 0,
        state: problem ? 'error' : 'uploading',
        error: problem ?? undefined,
      });
      items.unshift(item);
      if (!problem) valid.push([file, item]);
    }

    // Pool simples de concorrência
    const queue = [...valid];
    const workers = Array.from(
      { length: Math.min(options.concurrency ?? 3, queue.length) },
      async () => {
        for (let next = queue.shift(); next; next = queue.shift()) await uploadOne(...next);
      },
    );
    await Promise.all(workers);
  }

  function clearFinished() {
    for (let i = items.length - 1; i >= 0; i--)
      if (items[i].state !== 'uploading') items.splice(i, 1);
  }

  return { items, add, clearFinished };
}
