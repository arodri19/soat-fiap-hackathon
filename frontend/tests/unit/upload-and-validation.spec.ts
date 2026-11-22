import { AxiosError, type AxiosResponse } from 'axios';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import type { Video } from '@/api/types';
import { videosApi } from '@/api/videos';
import { usePolling } from '@/composables/usePolling';
import { useUploadQueue } from '@/composables/useUploadQueue';
import { loadConfig } from '@/config';
import {
  formatBytes,
  passwordProblems,
  passwordRule,
  passwordStrength,
  rules,
  validateVideoFile,
} from '@/utils/validation';

const file = (name: string, size = 10) => new File([new Uint8Array(size)], name);

describe('validações', () => {
  it('senha segue a política do backend', () => {
    expect(passwordProblems('curta1')).toEqual(['ao menos 8 caracteres']);
    expect(passwordProblems('somenteletras')).toEqual(['um número']);
    expect(passwordProblems('12345678')).toEqual(['uma letra']);
    expect(passwordProblems(`a1${'x'.repeat(80)}`)).toEqual(['no máximo 72 bytes']);
    expect(passwordRule('senhaForte1')).toBe(true);
    expect(passwordRule('fraca')).toMatch(/^A senha precisa de/);
  });

  it('força da senha de 0 a 4', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('senha123')).toBe(2);
    expect(passwordStrength('SenhaMuitoForte123!')).toBe(4);
  });

  it('regras de formulário', () => {
    expect(rules.required('Nome')('  ')).toBe('Nome é obrigatório');
    expect(rules.email('ana@exemplo.com')).toBe(true);
    expect(rules.email('ana@')).toBe('E-mail inválido');
    expect(rules.minLength(2, 'Nome')('a')).toBe('Nome deve ter ao menos 2 caracteres');
  });

  it('arquivo de vídeo: extensão, vazio e tamanho', () => {
    expect(validateVideoFile(file('aula.MP4'), 1)).toBeNull();
    expect(validateVideoFile(file('planilha.xlsx'), 1)).toMatch(/Formato não suportado/);
    expect(validateVideoFile(file('sem-extensao'), 1)).toMatch(/Formato não suportado/);
    expect(validateVideoFile(file('vazio.mp4', 0), 1)).toBe('Arquivo vazio');
    expect(validateVideoFile(file('grande.mp4', 2 * 1024 * 1024), 1)).toBe(
      'Arquivo maior que 1 MB',
    );
  });

  it('formata tamanhos', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3,0 MB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
  });

  it('config de runtime tem prioridade sobre os padrões', () => {
    expect(loadConfig({ apiBaseUrl: 'http://api', maxUploadMb: 10 })).toMatchObject({
      apiBaseUrl: 'http://api',
      maxUploadMb: 10,
      pollIntervalMs: 3000,
    });
  });
});

describe('useUploadQueue', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => vi.restoreAllMocks());

  it('envia os válidos em paralelo, recusa os inválidos e avisa a cada upload', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const upload = vi.spyOn(videosApi, 'upload').mockImplementation(async (f, onProgress) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      onProgress?.(0.5);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      if (f.name.startsWith('quebra')) {
        throw new AxiosError('413', 'ERR_BAD_REQUEST', undefined, undefined, {
          status: 413,
          data: { error: 'Arquivo maior que o limite de 500 MB' },
        } as AxiosResponse);
      }
      return {} as Video;
    });
    const onUploaded = vi.fn();
    const queue = useUploadQueue({ maxMb: 1, concurrency: 2, onUploaded });

    await queue.add([
      file('a.mp4'),
      file('b.webm'),
      file('doc.pdf'),
      file('quebra.mov'),
      file('c.mkv'),
    ]);

    expect(upload.mock.calls.map(([f]) => f.name)).toEqual([
      'a.mp4',
      'b.webm',
      'quebra.mov',
      'c.mkv',
    ]);
    expect(maxInFlight).toBe(2); // respeita o limite de concorrência
    const byName = Object.fromEntries(queue.items.map((i) => [i.name, i]));
    expect(byName['a.mp4']).toMatchObject({ state: 'done', progress: 100 });
    expect(byName['doc.pdf']).toMatchObject({ state: 'error' });
    expect(byName['quebra.mov']).toMatchObject({
      state: 'error',
      error: 'Arquivo maior que o limite de 500 MB',
    });
    expect(onUploaded).toHaveBeenCalledTimes(3);

    queue.clearFinished();
    expect(queue.items).toHaveLength(0);
  });
});

describe('usePolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('só roda enquanto habilitado', async () => {
    const task = vi.fn();
    const enabled = ref(false);
    const { stop } = usePolling(task, 1000, enabled);

    vi.advanceTimersByTime(3000);
    expect(task).not.toHaveBeenCalled();

    enabled.value = true;
    await nextTick();
    vi.advanceTimersByTime(3000);
    expect(task).toHaveBeenCalledTimes(3);

    enabled.value = false;
    await nextTick();
    vi.advanceTimersByTime(3000);
    expect(task).toHaveBeenCalledTimes(3);
    stop();
  });
});
