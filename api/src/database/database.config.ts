import { DataSourceOptions } from 'typeorm';
import { ENTITIES } from '../entities';
import { MIGRATIONS } from '../migrations';

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      'DATABASE_URL is not set. Point it at PostgreSQL, e.g. postgres://letsgo:secret@letsgo-db:5432/letsgo',
    );
  return url;
}

/**
 * PostgreSQL with versioned migrations. The schema only ever changes through
 * src/migrations, which run automatically (in order, once each) on startup.
 */
export function databaseOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url: databaseUrl(),
    entities: ENTITIES,
    migrations: MIGRATIONS,
    migrationsRun: true,
    migrationsTransactionMode: 'each',
    synchronize: false,
    extra: { max: Number(process.env.DB_POOL_MAX ?? 10) },
  };
}
