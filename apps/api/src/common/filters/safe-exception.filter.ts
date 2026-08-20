import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { isCapabilityPolicyDeniedError } from '@ventureos/database';
import { StructuredLogger } from '@ventureos/observability';
import { safeRequestPath } from '../logging/safe-request-path';

const logger = new StructuredLogger('api');

/**
 * Ensures no internal error detail (stack traces, DB errors, secrets) ever
 * reaches an HTTP client or structured log. Correlation ID, status, and path
 * remain available for tracing without retaining exception payloads.
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const isPolicyDenied = isCapabilityPolicyDeniedError(exception);
    const status = isHttp
      ? exception.getStatus()
      : isPolicyDenied
        ? HttpStatus.FORBIDDEN
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const safeMessage = isHttp
      ? exception.message
      : isPolicyDenied
        ? 'Operation is not available'
        : 'An unexpected error occurred.';

    const logContext = {
      correlationId: req.correlationId,
      path: safeRequestPath(req.path),
      status,
    };
    const isControlledClientOutcome =
      status === HttpStatus.UNAUTHORIZED ||
      status === HttpStatus.FORBIDDEN ||
      status === HttpStatus.TOO_MANY_REQUESTS;
    if (isControlledClientOutcome) {
      logger.warn('controlled client exception', logContext);
    } else {
      logger.error('request exception', logContext);
    }

    const retryAfter =
      typeof exception === 'object' &&
      exception !== null &&
      'retryAfterSeconds' in exception &&
      typeof exception.retryAfterSeconds === 'number'
        ? Math.min(900, Math.max(1, Math.ceil(exception.retryAfterSeconds)))
        : undefined;
    if (status === HttpStatus.TOO_MANY_REQUESTS && retryAfter !== undefined) {
      res.setHeader('Retry-After', String(retryAfter));
    }

    res.status(status).json({
      statusCode: status,
      message: safeMessage,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    });
  }
}
