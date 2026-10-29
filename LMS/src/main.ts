import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { LibraryConfigService } from './common/config/library.config';

/**
 * Monolith entry point. main.js (dist/main.js after `npm run build`) starts
 * the HTTP API plus every in-process worker:
 *   - outbox relay
 *   - Debezium -> Elasticsearch indexer consumer
 *   - notification consumer
 *   - hold-expiry and fine-accrual schedulers
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(LibraryConfigService);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.enableCors();
  app.enableShutdownHooks();

  if (!config.isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Library Management System')
      .setDescription('NestJS monolith implementing arch.md and LLD.md')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(
    `LMS monolith listening on :${config.port} (env=${config.nodeEnv}, docs=/docs, health=/health)`,
  );
}

void bootstrap();
