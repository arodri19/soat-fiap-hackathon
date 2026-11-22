import nodemailer, { type Transporter } from 'nodemailer';
import type { Mailer } from '../../application/ports';
import type { EmailMessage } from '../../domain/video-failed';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
}

/** Envio via SMTP (Mailpit no ambiente local; qualquer provedor SMTP em produção). */
export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly settings: SmtpSettings) {
    this.transporter = nodemailer.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: settings.user ? { user: settings.user, pass: settings.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.settings.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.transporter.verify();
      return true;
    } catch {
      return false;
    }
  }

  close(): void {
    this.transporter.close();
  }
}
