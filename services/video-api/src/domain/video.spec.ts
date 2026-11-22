import { UnsupportedVideoFormatError } from './errors';
import { sanitizeFilename, videoExtension, zipDownloadName } from './video';

describe('regras do vídeo', () => {
  it.each(['a.mp4', 'b.AVI', 'c.mov', 'd.mkv', 'e.wmv', 'f.flv', 'g.webm', 'com.pontos.Mp4'])(
    'aceita %s',
    (name) => {
      expect(videoExtension(name)).toBe(name.split('.').pop()!.toLowerCase());
    },
  );

  it.each(['sem-extensao', 'doc.pdf', 'script.mp4.exe', '.mp4x', 'video.'])('recusa %s', (name) => {
    expect(() => videoExtension(name)).toThrow(UnsupportedVideoFormatError);
  });

  it('sanitiza o nome: tira caminho e caracteres de controle e limita a 255', () => {
    expect(sanitizeFilename('C:\\Users\\ana\\aula.mp4')).toBe('aula.mp4');
    expect(sanitizeFilename('a\u0000b\nc.mp4')).toBe('abc.mp4');
    const long = sanitizeFilename(`${'x'.repeat(300)}.webm`);
    expect(long).toHaveLength(255);
    expect(long.endsWith('.webm')).toBe(true);
  });

  it('nome do zip baixado', () => {
    expect(zipDownloadName('apresentacao.mp4')).toBe('apresentacao_frames.zip');
    expect(zipDownloadName('.mp4')).toBe('video_frames.zip');
  });
});
