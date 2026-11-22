import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { apiErrorMessage } from '@/api/http';
import type { StatusCounts, Video, VideoStatus } from '@/api/types';
import { videosApi } from '@/api/videos';
import { useNotifyStore } from './notify';

const emptyCounts = (): StatusCounts => ({ PENDING: 0, PROCESSING: 0, DONE: 0, FAILED: 0 });

/** Lista de vídeos do usuário, com filtro, paginação e aviso quando um vídeo termina. */
export const useVideosStore = defineStore('videos', () => {
  const items = ref<Video[]>([]);
  const total = ref(0);
  const counts = ref<StatusCounts>(emptyCounts());
  const page = ref(1);
  const pageSize = ref(10);
  const status = ref<VideoStatus | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  /** Último status visto de cada vídeo, para avisar quando muda. */
  const lastSeen = new Map<string, VideoStatus>();

  const activeCount = computed(() => counts.value.PENDING + counts.value.PROCESSING);
  const totalAll = computed(() => Object.values(counts.value).reduce((a, b) => a + b, 0));

  async function fetch({ silent = false } = {}) {
    if (!silent) loading.value = true;
    try {
      const data = await videosApi.list({
        page: page.value,
        pageSize: pageSize.value,
        status: status.value,
      });
      notifyTransitions(data.items);
      items.value = data.items;
      total.value = data.total;
      counts.value = data.counts;
      error.value = null;
    } catch (e) {
      error.value = apiErrorMessage(e, 'Não foi possível carregar seus vídeos.');
    } finally {
      loading.value = false;
    }
  }

  function notifyTransitions(list: Video[]) {
    const notify = useNotifyStore();
    for (const v of list) {
      const before = lastSeen.get(v.id);
      if (before && before !== v.status) {
        if (v.status === 'DONE')
          notify.success(`"${v.original_filename}" está pronto para download`);
        if (v.status === 'FAILED') notify.error(`Falha ao processar "${v.original_filename}"`);
      }
      lastSeen.set(v.id, v.status);
    }
  }

  function setFilter(next: VideoStatus | null) {
    status.value = next;
    page.value = 1;
    return fetch();
  }

  function setPage(next: number, size = pageSize.value) {
    page.value = next;
    pageSize.value = size;
    return fetch();
  }

  /** Busca a URL temporária e dispara o download pelo navegador. */
  async function download(video: Video) {
    try {
      const { url } = await videosApi.downloadUrl(video.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${video.original_filename.replace(/\.[^.]+$/, '')}_frames.zip`;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      useNotifyStore().error(apiErrorMessage(e, 'Não foi possível gerar o download.'));
    }
  }

  function reset() {
    items.value = [];
    total.value = 0;
    counts.value = emptyCounts();
    page.value = 1;
    status.value = null;
    lastSeen.clear();
  }

  return {
    items,
    total,
    counts,
    page,
    pageSize,
    status,
    loading,
    error,
    activeCount,
    totalAll,
    fetch,
    setFilter,
    setPage,
    download,
    reset,
  };
});
