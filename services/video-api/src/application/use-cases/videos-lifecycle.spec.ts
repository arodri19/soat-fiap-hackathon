import { VideoNotFoundError, VideoNotReadyError } from '../../domain/errors';
import {
  FixedClock,
  InMemoryVideoRepository,
  InMemoryVideoStorage,
  OTHER_USER,
  SequentialIds,
  USER,
  streamOf,
} from '../testing/fakes';
import { ApplyStatusEvent } from './apply-status-event';
import { GetDownloadUrl, GetVideo, ListVideos } from './query-videos';
import { UploadVideo } from './upload-video';

describe('ciclo de vida do vídeo', () => {
  const setup = () => {
    const videos = new InMemoryVideoRepository();
    const storage = new InMemoryVideoStorage();
    const clock = new FixedClock();
    const upload = new UploadVideo(videos, storage, new SequentialIds(), clock);
    const send = async (filename: string, user = USER) => {
      clock.advanceSeconds(1);
      return upload.execute({ user, filename, contentType: 'video/mp4', stream: streamOf('v') });
    };
    return {
      videos,
      clock,
      send,
      apply: new ApplyStatusEvent(videos, clock),
      list: new ListVideos(videos),
      get: new GetVideo(videos),
      download: new GetDownloadUrl(videos, storage, 300),
    };
  };

  const at = new Date('2026-11-22T10:05:00Z');

  describe('ApplyStatusEvent', () => {
    it('PENDING → PROCESSING → DONE grava zip e quantidade de frames', async () => {
      const { send, apply, videos } = setup();
      const v = await send('a.mp4');

      await expect(
        apply.execute({ videoId: v.id, occurredAt: at, update: { status: 'PROCESSING' } }),
      ).resolves.toBe('applied');
      await expect(
        apply.execute({
          videoId: v.id,
          occurredAt: at,
          update: { status: 'DONE', zipKey: 'user-a/x.zip', frameCount: 42 },
        }),
      ).resolves.toBe('applied');

      expect(videos.videos[0]).toMatchObject({
        status: 'DONE',
        zipKey: 'user-a/x.zip',
        frameCount: 42,
      });
    });

    it('é idempotente e não regride: PROCESSING atrasado depois de DONE é ignorado', async () => {
      const { send, apply, videos } = setup();
      const v = await send('a.mp4');
      const done = {
        videoId: v.id,
        occurredAt: at,
        update: { status: 'DONE' as const, zipKey: 'k.zip', frameCount: 1 },
      };

      await apply.execute(done);
      await expect(apply.execute(done)).resolves.toBe('ignored');
      await expect(
        apply.execute({ videoId: v.id, occurredAt: at, update: { status: 'PROCESSING' } }),
      ).resolves.toBe('ignored');
      expect(videos.videos[0].status).toBe('DONE');
    });

    it('FAILED grava a mensagem de erro; DONE depois de FAILED é ignorado', async () => {
      const { send, apply, videos } = setup();
      const v = await send('a.mp4');

      await apply.execute({
        videoId: v.id,
        occurredAt: at,
        update: { status: 'FAILED', errorMessage: 'ffmpeg: arquivo corrompido' },
      });
      await expect(
        apply.execute({
          videoId: v.id,
          occurredAt: at,
          update: { status: 'DONE', zipKey: 'k.zip', frameCount: 1 },
        }),
      ).resolves.toBe('ignored');
      expect(videos.videos[0]).toMatchObject({
        status: 'FAILED',
        errorMessage: 'ffmpeg: arquivo corrompido',
      });
    });

    it('vídeo inexistente é ignorado', async () => {
      const { apply } = setup();
      await expect(
        apply.execute({ videoId: 'nao-existe', occurredAt: at, update: { status: 'PROCESSING' } }),
      ).resolves.toBe('ignored');
    });
  });

  describe('ListVideos', () => {
    it('lista só os vídeos do usuário, mais recentes primeiro, com totais por status', async () => {
      const { send, apply, list } = setup();
      const first = await send('1.mp4');
      await send('2.mp4');
      await send('outro.mp4', OTHER_USER);
      await apply.execute({ videoId: first.id, occurredAt: at, update: { status: 'PROCESSING' } });

      const page = await list.execute(USER.id, { page: 1, pageSize: 20 });

      expect(page.items.map((v) => v.originalFilename)).toEqual(['2.mp4', '1.mp4']);
      expect(page.total).toBe(2);
      expect(page.counts).toEqual({ PENDING: 1, PROCESSING: 1, DONE: 0, FAILED: 0 });
    });

    it('filtra por status e pagina', async () => {
      const { send, list } = setup();
      for (let i = 1; i <= 5; i++) await send(`${i}.mp4`);

      const page2 = await list.execute(USER.id, { status: 'PENDING', page: 2, pageSize: 2 });

      expect(page2.items.map((v) => v.originalFilename)).toEqual(['3.mp4', '2.mp4']);
      expect(page2).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    });
  });

  describe('GetVideo e GetDownloadUrl', () => {
    it('vídeo de outro usuário responde como inexistente', async () => {
      const { send, get, download } = setup();
      const v = await send('a.mp4', OTHER_USER);

      await expect(get.execute(USER.id, v.id)).rejects.toBeInstanceOf(VideoNotFoundError);
      await expect(download.execute(USER.id, v.id)).rejects.toBeInstanceOf(VideoNotFoundError);
    });

    it('download só quando DONE; URL temporária com nome amigável', async () => {
      const { send, apply, download } = setup();
      const v = await send('Minha Aula.mov');

      await expect(download.execute(USER.id, v.id)).rejects.toBeInstanceOf(VideoNotReadyError);

      await apply.execute({
        videoId: v.id,
        occurredAt: at,
        update: { status: 'DONE', zipKey: 'user-a/v.zip', frameCount: 10 },
      });
      const result = await download.execute(USER.id, v.id);

      expect(result.expiresIn).toBe(300);
      expect(result.url).toBe(
        'https://storage.test/user-a/v.zip?name=Minha%20Aula_frames.zip&ttl=300',
      );
    });
  });
});
