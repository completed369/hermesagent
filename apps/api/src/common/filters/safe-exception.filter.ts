import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { StructuredLogger } from '@ventureos/observability';

const logger = new StructuredLogger('api');

/**
 * Ensures no internal error detail (stack traces, DB errors, secrets) ever
 * reaches an HTTP client. Full detail is still logged server-side with the
 * request's correlation ID so it can be traced.
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const safeMessage = isHttp ? exception.message : 'An unexpected error occurred.';

    logger.error('unhandled exception', {
      correlationId: req.correlationId,
      path: req.originalUrl,
      status,
      error: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    });

    res.status(status).json({
      statusCode: status,
      message: safeMessage,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
    });
  }
}
