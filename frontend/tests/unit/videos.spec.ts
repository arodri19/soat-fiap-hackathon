import { http as mswHttp, HttpResponse } from 'msw';
import { createPinia, setActivePinia } from 'pinia';
import type { Video, VideoPage } from '@/api/types';
import { useNotifyStore } from '@/stores/notify';
import { useVideosStore } from '@/stores/videos';
import { server } from '../setup';

const video = (over: Partial<Video> = {}): Video => ({
  id: 'v1',
  original_filename: 'aula.mp4',
  size_bytes: 1000,
  status: 'PENDING',
  frame_count: null,
  error_message: null,
  created_at: '2026-11-22T10:00:00Z',
  updated_at: '2026-11-22T10:00:00Z',
  ...over,
});

const page = (items: Video[], over: Partial<VideoPage> = {}): VideoPage => ({
  items,
  page: 1,
  page_size: 10,
  total: items.length,
  counts: { PENDING: 0, PROCESSING: 0, DONE: 0, FAILED: 0, ...over.counts },
  ...over,
});

describe('videos store', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('carrega a lista com filtro e paginação na query', async () => {
    const queries: string[] = [];
    server.use(
      mswHttp.get('*/api/videos', ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json(
          page([video()], {
            total: 31,
            counts: { PENDING: 1, PROCESSING: 2, DONE: 28, FAILED: 0 },
          }),
        );
      }),
    );
    const store = useVideosStore();

    await store.fetch();
    await store.setFilter('DONE');
    await store.setPage(3, 20);

    expect(queries).toEqual([
      '?page=1&page_size=10',
      '?page=1&page_size=10&status=DONE',
      '?page=3&page_size=20&status=DONE',
    ]);
    expect(store.total).toBe(31);
    expect(store.activeCount).toBe(3);
    expect(store.totalAll).toBe(31);
  });

  it('avisa quando um vídeo termina ou falha (sem avisar na primeira carga)', async () => {
    const responses = [
      page([
        video({ id: 'a' }),
        video({ id: 'b', original_filename: 'ruim.mkv', status: 'PROCESSING' }),
      ]),
      page([
        video({ id: 'a', status: 'DONE', frame_count: 10 }),
        video({ id: 'b', original_filename: 'ruim.mkv', status: 'FAILED' }),
      ]),
    ];
    server.use(mswHttp.get('*/api/videos', () => HttpResponse.json(responses.shift())));
    const store = useVideosStore();
    const notify = useNotifyStore();

    await store.fetch();
    expect(notify.toasts).toHaveLength(0);

    await store.fetch({ silent: true });
    expect(notify.toasts.map((t) => [t.color, t.text])).toEqual([
      ['success', '"aula.mp4" está pronto para download'],
      ['error', 'Falha ao processar "ruim.mkv"'],
    ]);
  });

  it('erro da API vira mensagem na tela', async () => {
    server.use(mswHttp.get('*/api/videos', () => HttpResponse.error()));
    const store = useVideosStore();

    await store.fetch();

    expect(store.error).toBe('Não foi possível conectar ao servidor.');
    expect(store.loading).toBe(false);
  });

  it('download abre a URL temporária; vídeo não pronto vira aviso', async () => {
    server.use(
      mswHttp.get('*/api/videos/ok/download', () =>
        HttpResponse.json({ url: 'http://storage/x.zip', expires_in: 300 }),
      ),
      mswHttp.get('*/api/videos/nao/download', () =>
        HttpResponse.json(
          { error: 'O vídeo ainda não está pronto para download (status: PENDING)' },
          { status: 409 },
        ),
      ),
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const store = useVideosStore();

    await store.download(video({ id: 'ok', original_filename: 'Minha aula.mp4', status: 'DONE' }));
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe('http://storage/x.zip');
    expect(anchor.download).toBe('Minha aula_frames.zip');

    await store.download(video({ id: 'nao' }));
    expect(useNotifyStore().toasts.at(-1)?.text).toContain('ainda não está pronto');
  });

  it('reset limpa tudo (logout)', async () => {
    server.use(mswHttp.get('*/api/videos', () => HttpResponse.json(page([video()], { total: 1 }))));
    const store = useVideosStore();
    await store.fetch();

    store.reset();

    expect(store.items).toEqual([]);
    expect(store.totalAll).toBe(0);
  });
});
