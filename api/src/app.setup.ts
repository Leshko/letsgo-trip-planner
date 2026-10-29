import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { DbErrorFilter } from './common/db-error.filter';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Everything main.ts and the test harness both need applied to the app. */
export function configureApp(app: INestApplication): void {
  // Avatar uploads arrive as base64 JSON; Express's default 100 KB JSON limit is too small.
  const express = app as Partial<NestExpressApplication>;
  if (typeof express.useBodyParser === 'function')
    express.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new DbErrorFilter(app.get(HttpAdapterHost).httpAdapter));
}
