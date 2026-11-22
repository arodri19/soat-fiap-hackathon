import type { EmailMessage, VideoFailedEvent } from '../../domain/video-failed';
import { FailureEmailComposer } from '../../infrastructure/mail/template';
import type { ClaimResult, IdempotencyStore, Mailer } from '../ports';
import { NotifyVideoFailed } from './notify-video-failed';

class FakeMailer implements Mailer {
  sent: EmailMessage[] = [];
  fail: Error | null = null;
  async send(message: EmailMessage) {
    if (this.fail) throw this.fail;
    this.sent.push(message);
  }
}

class InMemoryIdempotency implements IdempotencyStore {
  state = new Map<string, 'pending' | 'sent'>();
  async claim(id: string): Promise<ClaimResult> {
    if (this.state.has(id)) return 'already-handled';
    this.state.set(id, 'pending');
    return 'claimed';
  }
  async markSent(id: string) {
    this.state.set(id, 'sent');
  }
  async release(id: string) {
    this.state.delete(id);
  }
}

const event = (overrides: Partial<VideoFailedEvent> = {}): VideoFailedEvent => ({
  eventId: 'evt-1',
  occurredAt: new Date('2026-11-22T15:30:00Z'),
  videoId: 'v1',
  userId: 'u1',
  userEmail: 'ana@exemplo.com',
  originalFilename: 'aula.mp4',
  error: 'ffmpeg: Invalid data found when processing input',
  attempts: 1,
  ...overrides,
});

describe('NotifyVideoFailed', () => {
  const setup = () => {
    const mailer = new FakeMailer();
    const store = new InMemoryIdempotency();
    const useCase = new NotifyVideoFailed(
      mailer,
      store,
      new FailureEmailComposer('http://localhost:8080/'),
    );
    return { mailer, store, useCase };
  };

  it('envia o e-mail para o dono do vídeo e marca o evento como enviado', async () => {
    const { mailer, store, useCase } = setup();

    await expect(useCase.execute(event())).resolves.toBe('sent');

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({
      to: 'ana@exemplo.com',
      subject: 'Falha ao processar o vídeo "aula.mp4"',
    });
    expect(store.state.get('evt-1')).toBe('sent');
  });

  it('evento repetido (reentrega) não envia um segundo e-mail', async () => {
    const { mailer, useCase } = setup();

    await useCase.execute(event());
    await expect(useCase.execute(event())).resolves.toBe('duplicate');

    expect(mailer.sent).toHaveLength(1);
  });

  it('se o SMTP falhar, libera a reserva para a próxima tentativa enviar', async () => {
    const { mailer, store, useCase } = setup();
    mailer.fail = new Error('ECONNREFUSED');

    await expect(useCase.execute(event())).rejects.toThrow('ECONNREFUSED');
    expect(store.state.has('evt-1')).toBe(false);

    mailer.fail = null;
    await expect(useCase.execute(event())).resolves.toBe('sent');
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('FailureEmailComposer', () => {
  const composer = new FailureEmailComposer('http://localhost:8080/');

  it('texto com motivo, horário de Brasília e link para os vídeos', () => {
    const mail = composer.videoFailed(event({ attempts: 3 }));

    expect(mail.text).toContain('Não foi possível processar o vídeo "aula.mp4" após 3 tentativas.');
    expect(mail.text).toContain('Motivo: ffmpeg: Invalid data found when processing input');
    expect(mail.text).toContain('Quando: 22/11/2026, 12:30');
    expect(mail.text).toContain('http://localhost:8080/videos');
    expect(mail.html).toContain('href="http://localhost:8080/videos"');
  });

  it('escapa no HTML o nome do arquivo e o erro (vêm do usuário/ffmpeg)', () => {
    const mail = composer.videoFailed(
      event({ originalFilename: '<script>alert(1)</script>.mp4', error: 'erro & "aspas"' }),
    );

    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;.mp4');
    expect(mail.html).toContain('erro &amp; &quot;aspas&quot;');
  });

  it('não menciona tentativas quando falhou na primeira', () => {
    expect(composer.videoFailed(event()).text).not.toContain('tentativas');
  });
});
