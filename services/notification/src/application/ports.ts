import type { EmailMessage, VideoFailedEvent } from '../domain/video-failed';

export interface Mailer {
  send(message: EmailMessage): Promise<void>;
}

export type ClaimResult = 'claimed' | 'already-handled';

/**
 * Garante que cada evento gere no máximo um e-mail, mesmo com reentrega
 * (at-least-once) ou várias réplicas consumindo a mesma fila.
 */
export interface IdempotencyStore {
  /** Reserva o evento para envio. 'already-handled' se já foi enviado ou outra réplica está enviando. */
  claim(eventId: string): Promise<ClaimResult>;
  /** Marca como enviado (guarda por alguns dias). */
  markSent(eventId: string): Promise<void>;
  /** Libera a reserva quando o envio falhou, para a próxima tentativa poder enviar. */
  release(eventId: string): Promise<void>;
}

export interface EmailComposer {
  videoFailed(event: VideoFailedEvent): EmailMessage;
}

export const MAILER = Symbol('Mailer');
export const IDEMPOTENCY_STORE = Symbol('IdempotencyStore');
export const EMAIL_COMPOSER = Symbol('EmailComposer');
