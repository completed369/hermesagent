import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { StructuredLogger } from '@ventureos/observability';

const logger = new StructuredLogger('api');

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          logger.info('request completed', {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            durationMs: Date.now() - start,
            correlationId: req.correlationId,
          });
        },
        error: (err: unknown) => {
          const statusCode = err instanceof HttpException ? err.getStatus() : undefined;
          const context = {
            method: req.method,
            path: req.path,
            statusCode,
            durationMs: Date.now() - start,
            correlationId: req.correlationId,
          };

          if (statusCode === 401 || statusCode === 429) {
            logger.warn('controlled client request', context);
            return;
          }

          logger.error('request failed', context);
        },
      }),
    );
  }
}
