/** Erros de domínio; o mapeamento para HTTP fica no filtro de exceções. */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnsupportedVideoFormatError extends DomainError {
  readonly code = 'UNSUPPORTED_FORMAT';
  constructor(allowed: readonly string[]) {
    super(`Formato não suportado. Use: ${allowed.join(', ')}`);
  }
}

export class MissingVideoFileError extends DomainError {
  readonly code = 'MISSING_FILE';
  constructor() {
    super('Envie o arquivo no campo "video" (multipart/form-data)');
  }
}

export class EmptyVideoFileError extends DomainError {
  readonly code = 'EMPTY_FILE';
  constructor() {
    super('O arquivo enviado está vazio');
  }
}

export class VideoTooLargeError extends DomainError {
  readonly code = 'FILE_TOO_LARGE';
  constructor(maxBytes: number) {
    super(`Arquivo maior que o limite de ${Math.round(maxBytes / 1024 / 1024)} MB`);
  }
}

/** Também usado quando o vídeo é de outro usuário: não revela que ele existe. */
export class VideoNotFoundError extends DomainError {
  readonly code = 'VIDEO_NOT_FOUND';
  constructor() {
    super('Vídeo não encontrado');
  }
}

export class VideoNotReadyError extends DomainError {
  readonly code = 'VIDEO_NOT_READY';
  constructor(status: string) {
    super(`O vídeo ainda não está pronto para download (status: ${status})`);
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = 'UNAUTHORIZED';
  constructor() {
    super('Não autenticado ou token inválido/expirado');
  }
}
