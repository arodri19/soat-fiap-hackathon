import {
  BadRequestException,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
  type ValidationError,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  DomainError,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidSessionError,
  TooManyLoginAttemptsError,
  WeakPasswordError,
} from '../../domain/errors';

export interface ErrorBody {
  error: string;
  details?: { field: string; message: string }[];
}

/** Erro de validação de DTO com a lista de campos, no formato do contrato. */
export class ValidationFailedException extends BadRequestException {
  constructor(readonly details: { field: string; message: string }[]) {
    super('Dados inválidos');
  }

  static fromErrors(errors: ValidationError[]): ValidationFailedException {
    const details = errors.flatMap((e) =>
      Object.values(e.constraints ?? {}).map((message) => ({ field: e.property, message })),
    );
    return new ValidationFailedException(details);
  }
}

const DOMAIN_STATUS = new Map<abstract new (...args: never[]) => DomainError, HttpStatus>([
  [EmailAlreadyRegisteredError, HttpStatus.CONFLICT],
  [WeakPasswordError, HttpStatus.BAD_REQUEST],
  [InvalidCredentialsError, HttpStatus.UNAUTHORIZED],
  [InvalidSessionError, HttpStatus.UNAUTHORIZED],
  [TooManyLoginAttemptsError, HttpStatus.TOO_MANY_REQUESTS],
]);

/** Converte qualquer erro no corpo `{ error, details? }` definido em contracts/openapi/auth.yaml. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      const status =
        DOMAIN_STATUS.get(exception.constructor as abstract new () => DomainError) ??
        HttpStatus.BAD_REQUEST;
      if (exception instanceof TooManyLoginAttemptsError) {
        res.setHeader('Retry-After', String(exception.retryAfterSeconds));
      }
      const body: ErrorBody =
        exception instanceof WeakPasswordError
          ? {
              error: 'Dados inválidos',
              details: [{ field: 'password', message: exception.message }],
            }
          : { error: exception.message };
      res.status(status).json(body);
      return;
    }

    if (exception instanceof ValidationFailedException) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .json({ error: 'Dados inválidos', details: exception.details });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      res.status(status).json({ error: Array.isArray(message) ? message.join('; ') : message });
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Erro interno' });
  }
}
