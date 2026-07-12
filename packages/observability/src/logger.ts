import { redactSecrets } from '@ventureos/security';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  correlationId?: string;
  workflowId?: string;
  workspaceId?: string;
  actorId?: string;
  [key: string]: unknown;
}

/**
 * Minimal structured JSON logger. Every log line is a single JSON object on
 * stdout so it is trivially ingestible by any log pipeline, and every field
 * passes through secret redaction before being written.
 */
export class StructuredLogger {
  constructor(
    private readonly service: string,
    private readonly minLevel: LogLevel = 'info',
  ) {}

  private static readonly LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  private write(level: LogLevel, message: string, fields: LogFields = {}): void {
    if (StructuredLogger.LEVEL_ORDER[level] < StructuredLogger.LEVEL_ORDER[this.minLevel]) return;
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      message,
      ...redactSecrets(fields),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
  }

  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields);
  }
  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields);
  }
  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields);
  }
  error(message: string, fields?: LogFields): void {
    this.write('error', message, fields);
  }
}
