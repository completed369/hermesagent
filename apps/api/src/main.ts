import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { loadEnv } from '@ventureos/config';
import { StructuredLogger } from '@ventureos/observability';
import { AppModule } from './app.module';

async function bootstrap() {
  // Fail closed immediately if environment configuration is invalid.
  const env = loadEnv();
  const logger = new StructuredLogger('api');

  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.getHttpAdapter().getInstance().set('trust proxy', env.API_TRUST_PROXY_HOPS);
  app.use(cookieParser());
  app.enableCors({ origin: env.API_CORS_ORIGIN, credentials: true });
  app.setGlobalPrefix('api');

  // Swagger doc generation is best-effort, not load-bearing: under the tsx
  // dev runner, @nestjs/swagger's parameter explorer has been observed to
  // throw on esbuild-emitted decorator metadata for some custom parameter
  // decorators (TypeError reading '0' of undefined in
  // ParameterMetadataAccessor.explore). Rather than let a docs-generation
  // bug take down the whole API, isolate it and log a warning instead.
  // See docs/KNOWN_LIMITATIONS.md.
  try {
    const config = new DocumentBuilder()
      .setTitle('VentureOS API')
      .setDescription('VentureOS - Human-Controlled AI Business Operating System')
      .setVersion('0.1.0')
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  } catch (err) {
    logger.warn('Swagger doc generation failed - API will still start without /api/docs', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await app.listen(env.API_PORT);
  logger.info('API started', { port: env.API_PORT, env: env.NODE_ENV });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[api] fatal bootstrap error:', err);
  process.exit(1);
});
