import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  DomainException,
  isLockTimeout,
  isStatementTimeout,
  isUniqueViolation,
} from './domain.exception';

/**
 * One error shape for the whole API (LLD section 9.4):
 *
 *   { "code": "HOLD_EXPIRED", "message": "...", "traceId": "..." }
 *
 * DomainException already has a code/status pair. HttpException (validation
 * pipe, guards) and low-level PostgreSQL failures are translated here so raw
 * SQLSTATE values never leak to clients.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { traceId?: string }>();
    const response = context.getResponse<Response>();
    const traceId = request.traceId ?? 'unknown';

    const mapped = this.map(exception);
    if (mapped.status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${mapped.code} (traceId=${traceId})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(mapped.status).json({
      code: mapped.code,
      message: mapped.message,
      traceId,
    });
  }

  private map(exception: unknown): { status: number; code: string; message: string } {
    if (exception instanceof DomainException) {
      return {
        status: exception.httpStatus,
        code: exception.code,
        message: exception.message,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const rawMessage =
        typeof payload === 'string'
          ? payload
          : (payload as { message?: string | string[] }).message;
      const message = Array.isArray(rawMessage)
        ? rawMessage.join(', ')
        : (rawMessage ?? exception.message);
      return { status, code: this.httpCode(status), message };
    }

    if (isUniqueViolation(exception)) {
      return {
        status: 409,
        code: 'DUPLICATE_RESOURCE',
        message: 'The request conflicts with an existing resource',
      };
    }

    if (isLockTimeout(exception) || isStatementTimeout(exception)) {
      return {
        status: 503,
        code: 'SERVICE_UNAVAILABLE',
        message: 'The database is contended, please retry',
      };
    }

    return {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Unexpected error',
    };
  }

  private httpCode(status: number): string {
    switch (status) {
      case 400:
        return 'VALIDATION_ERROR';
      case 401:
        return 'UNAUTHENTICATED';
      case 403:
        return 'FORBIDDEN';
      case 404:
        return 'NOT_FOUND';
      case 409:
        return 'CONFLICT';
      case 422:
        return 'UNPROCESSABLE_ENTITY';
      case 429:
        return 'RATE_LIMITED';
      case 503:
        return 'SERVICE_UNAVAILABLE';
      default:
        return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
    }
  }
}
