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

  app.use(cookieParser());
  app.enableCors({ origin: env.API_CORS_ORIGIN, credentials: true });
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('VentureOS API')
    .setDescription('VentureOS - Human-Controlled AI Business Operating System')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(env.API_PORT);
  logger.info('API started', { port: env.API_PORT, env: env.NODE_ENV });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[api] fatal bootstrap error:', err);
  process.exit(1);
});
