import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { backupBeforeUpgrade } from './database/backup';
import {
  EmbeddedPostgres,
  startEmbeddedPostgres,
} from './database/embedded-postgres';

async function bootstrap() {
  // No DATABASE_URL: use the database built into the container.
  let pg: EmbeddedPostgres | null = null;
  if (!process.env.DATABASE_URL) {
    pg = await startEmbeddedPostgres();
    process.env.DATABASE_URL = pg.url;
  }
  let stopping = false;
  pg?.onUnexpectedExit((code) => {
    if (stopping) return;
    console.error(
      `[database] PostgreSQL stopped unexpectedly (${code}); restarting the container`,
    );
    process.exit(1);
  });

  try {
    await backupBeforeUpgrade().catch((e: unknown) =>
      console.error(`[backup] Snapshot before updating failed: ${String(e)}`),
    );
    const app = await NestFactory.create(AppModule);
    configureApp(app);

    // Docker stop / Unraid update: close the app, then the database, cleanly.
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      await app.close().catch(() => undefined);
      await pg?.stop();
      process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown());
    process.on('SIGINT', () => void shutdown());

    const port = Number(process.env.PORT ?? 3001);
    await app.listen(port);
    console.log(
      `LetsGo Together API listening on http://localhost:${port}/api`,
    );
  } catch (e) {
    stopping = true;
    console.error(e);
    await pg?.stop();
    process.exit(1);
  }
}
void bootstrap();
