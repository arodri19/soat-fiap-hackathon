/** Evento video.failed publicado pelo processor-worker (contracts/asyncapi.yaml). */
export interface VideoFailedEvent {
  eventId: string;
  occurredAt: Date;
  videoId: string;
  userId: string;
  userEmail: string;
  originalFilename: string;
  error: string;
  attempts: number;
}

/** E-mail pronto para envio (texto puro + HTML). */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Erro de mensagem fora do contrato: vai para a DLQ, não adianta tentar de novo. */
export class InvalidEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEventError';
  }
}
