import {
  BadRequestException,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  DomainError,
  EmptyVideoFileError,
  MissingVideoFileError,
  UnauthorizedError,
  UnsupportedVideoFormatError,
  VideoNotFoundError,
  VideoNotReadyError,
  VideoTooLargeError,
} from '../../domain/errors';

export interface ErrorBody {
  error: string;
  details?: { field: string; message: string }[];
}

export class ValidationFailedException extends BadRequestException {
  constructor(readonly details: { field: string; message: string }[]) {
    super('Parâmetros inválidos');
  }
}

type DomainErrorClass = abstract new (...args: never[]) => DomainError;

const DOMAIN_STATUS = new Map<DomainErrorClass, HttpStatus>([
  [UnsupportedVideoFormatError, HttpStatus.BAD_REQUEST],
  [MissingVideoFileError, HttpStatus.BAD_REQUEST],
  [EmptyVideoFileError, HttpStatus.BAD_REQUEST],
  [VideoTooLargeError, HttpStatus.PAYLOAD_TOO_LARGE],
  [VideoNotFoundError, HttpStatus.NOT_FOUND],
  [VideoNotReadyError, HttpStatus.CONFLICT],
  [UnauthorizedError, HttpStatus.UNAUTHORIZED],
]);

/** Converte erros no corpo `{ error, details? }` definido em contracts/openapi/videos.yaml. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof DomainError) {
      const status =
        DOMAIN_STATUS.get(exception.constructor as DomainErrorClass) ?? HttpStatus.BAD_REQUEST;
      res.status(status).json({ error: exception.message } satisfies ErrorBody);
      return;
    }

    if (exception instanceof ValidationFailedException) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'Parâmetros inválidos', details: exception.details });
      return;
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      res
        .status(exception.getStatus())
        .json({ error: Array.isArray(message) ? message.join('; ') : message });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Erro interno' });
  }
}
