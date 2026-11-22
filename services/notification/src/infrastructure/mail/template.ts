import type { EmailComposer } from '../../application/ports';
import type { EmailMessage, VideoFailedEvent } from '../../domain/video-failed';

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const formatDate = (date: Date): string =>
  date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'short',
    timeStyle: 'short',
  });

/** Monta o e-mail de falha. Dados do usuário (nome do arquivo, erro) são escapados no HTML. */
export class FailureEmailComposer implements EmailComposer {
  constructor(private readonly appUrl: string) {}

  videoFailed(event: VideoFailedEvent): EmailMessage {
    const filename = event.originalFilename;
    const when = formatDate(event.occurredAt);
    const link = `${this.appUrl.replace(/\/$/, '')}/videos`;
    const attempts = event.attempts > 1 ? ` após ${event.attempts} tentativas` : '';

    const text = [
      'Olá,',
      '',
      `Não foi possível processar o vídeo "${filename}"${attempts}.`,
      '',
      `Motivo: ${event.error}`,
      `Quando: ${when}`,
      '',
      'Confira se o arquivo abre normalmente no seu computador e envie novamente.',
      `Acompanhe seus vídeos em: ${link}`,
      '',
      '— FIAP X',
    ].join('\n');

    const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1c1f24">
    <table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e3e6eb">
      <tr><td style="padding:24px 28px;border-bottom:1px solid #e3e6eb">
        <strong style="display:inline-block;background:#ed145b;color:#fff;border-radius:8px;padding:4px 10px">X</strong>
        <strong style="margin-left:8px">FIAP X</strong>
      </td></tr>
      <tr><td style="padding:28px">
        <h1 style="font-size:20px;margin:0 0 16px">Não foi possível processar seu vídeo</h1>
        <p style="margin:0 0 16px">O vídeo <strong>${escapeHtml(filename)}</strong> não pôde ser convertido em imagens${escapeHtml(attempts)}.</p>
        <p style="margin:0 0 6px;font-size:13px;color:#6b7280">Motivo</p>
        <p style="margin:0 0 16px;padding:12px;background:#fee2e2;color:#b91c1c;border-radius:8px;font-family:monospace;font-size:13px">${escapeHtml(event.error)}</p>
        <p style="margin:0 0 24px;font-size:13px;color:#6b7280">Quando: ${escapeHtml(when)}</p>
        <p style="margin:0 0 24px">Confira se o arquivo abre normalmente no seu computador e envie novamente.</p>
        <a href="${escapeHtml(link)}" style="display:inline-block;background:#ed145b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Ver meus vídeos</a>
      </td></tr>
    </table>
  </body>
</html>`;

    return {
      to: event.userEmail,
      subject: `Falha ao processar o vídeo "${filename}"`,
      text,
      html,
    };
  }
}
