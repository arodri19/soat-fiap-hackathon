import { EmptyVideoFileError, UnsupportedVideoFormatError } from '../../domain/errors';
import {
  FixedClock,
  InMemoryVideoRepository,
  InMemoryVideoStorage,
  SequentialIds,
  USER,
  streamOf,
} from '../testing/fakes';
import { UploadVideo } from './upload-video';

describe('UploadVideo', () => {
  const setup = () => {
    const videos = new InMemoryVideoRepository();
    const storage = new InMemoryVideoStorage();
    const useCase = new UploadVideo(videos, storage, new SequentialIds(), new FixedClock());
    return { videos, storage, useCase };
  };

  it('grava o arquivo, cria o vídeo PENDING e a mensagem video.requested na outbox', async () => {
    const { videos, storage, useCase } = setup();

    const video = await useCase.execute({
      user: USER,
      filename: 'Apresentação Final.MP4',
      contentType: 'video/mp4',
      stream: streamOf('conteudo-do-video'),
      requestId: 'req-123',
    });

    expect(video).toMatchObject({
      userId: 'user-a',
      userEmail: 'ana@exemplo.com',
      originalFilename: 'Apresentação Final.MP4',
      status: 'PENDING',
      sizeBytes: 17,
      storageKey: `user-a/${video.id}.mp4`,
    });
    expect(storage.objects.get(video.storageKey)?.toString()).toBe('conteudo-do-video');
    expect(videos.videos).toHaveLength(1);
    expect(videos.outbox).toEqual([
      {
        exchange: 'videos',
        routingKey: 'video.requested',
        messageId: expect.any(String),
        headers: { 'x-request-id': 'req-123' },
        payload: {
          event_id: videos.outbox[0].messageId,
          occurred_at: '2026-11-22T10:00:00.000Z',
          video_id: video.id,
          user_id: 'user-a',
          user_email: 'ana@exemplo.com',
          original_filename: 'Apresentação Final.MP4',
          storage_key: video.storageKey,
        },
      },
    ]);
  });

  it('a chave no storage vem do ID, nunca do nome enviado (sem path traversal)', async () => {
    const { useCase } = setup();

    const video = await useCase.execute({
      user: USER,
      filename: '../../etc/passwd.mkv',
      contentType: 'video/x-matroska',
      stream: streamOf('x'),
    });

    expect(video.storageKey).toBe(`user-a/${video.id}.mkv`);
    expect(video.originalFilename).toBe('passwd.mkv');
  });

  it('recusa formato não suportado sem gravar nada', async () => {
    const { videos, storage, useCase } = setup();

    await expect(
      useCase.execute({
        user: USER,
        filename: 'planilha.xlsx',
        contentType: 'application/octet-stream',
        stream: streamOf('x'),
      }),
    ).rejects.toBeInstanceOf(UnsupportedVideoFormatError);
    expect(storage.objects.size).toBe(0);
    expect(videos.videos).toHaveLength(0);
  });

  it('arquivo vazio é recusado e removido do storage', async () => {
    const { storage, useCase } = setup();

    await expect(
      useCase.execute({
        user: USER,
        filename: 'vazio.mp4',
        contentType: 'video/mp4',
        stream: streamOf(''),
      }),
    ).rejects.toBeInstanceOf(EmptyVideoFileError);
    expect(storage.objects.size).toBe(0);
    expect(storage.deleted).toHaveLength(1);
  });

  it('se o banco falhar, remove o arquivo e não deixa outbox', async () => {
    const { videos, storage, useCase } = setup();
    videos.failNextCreate = true;

    await expect(
      useCase.execute({
        user: USER,
        filename: 'a.mp4',
        contentType: 'video/mp4',
        stream: streamOf('x'),
      }),
    ).rejects.toThrow('banco indisponível');
    expect(storage.objects.size).toBe(0);
    expect(videos.outbox).toHaveLength(0);
  });

  it('se o upload for interrompido (ex.: limite de tamanho), limpa e repassa o erro', async () => {
    const { videos, storage, useCase } = setup();
    storage.failUpload = new Error('limite excedido');

    await expect(
      useCase.execute({
        user: USER,
        filename: 'a.mp4',
        contentType: 'video/mp4',
        stream: streamOf('x'),
      }),
    ).rejects.toThrow('limite excedido');
    expect(storage.deleted).toHaveLength(1);
    expect(videos.videos).toHaveLength(0);
  });
});
