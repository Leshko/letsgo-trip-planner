import { INestApplication, ValidationPipe } from '@nestjs/common';

/** Everything main.ts and the test harness both need applied to the app. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableCors({ origin: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
