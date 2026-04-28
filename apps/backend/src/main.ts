// Main NestJS application entry point
import './load-env.js';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { formatRuntimeBootLine } from './lib/runtime-build-marker.js';

async function bootstrap() {
  // Print build marker as the very first boot log so the running container is
  // unambiguous before we even initialise Nest.
  // eslint-disable-next-line no-console
  console.log(formatRuntimeBootLine());

  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const bootLogger = new Logger('Bootstrap');
  bootLogger.log(formatRuntimeBootLine('AISBP runtime'));

  // Global prefix
  const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');
  app.setGlobalPrefix(apiPrefix);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // CORS — comma-separated `CORS_ORIGIN` or a single URL. Default includes `127.0.0.1` so dev tools
  // / Playwright using that host still match the Next app origin rules.
  const corsRaw = configService.get<string>(
    'CORS_ORIGIN',
    'http://localhost:3000,http://127.0.0.1:3000',
  );
  const corsOrigins = corsRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length <= 1 ? corsOrigins[0] ?? 'http://localhost:3000' : corsOrigins,
    credentials: true,
  });

  // Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('AISBP API')
    .setDescription('AI SaaS Business Platform API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = configService.get<number>('PORT', 3001);
  await app.listen(port);
  console.log(`🚀 AISBP Backend running on http://localhost:${port}/${apiPrefix}`);
}

bootstrap();
