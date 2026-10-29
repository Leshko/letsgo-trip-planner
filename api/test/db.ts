import { Client } from 'pg';

/** Admin connection used to create a throwaway database per test suite. */
export const ADMIN_URL =
  process.env.TEST_PG_ADMIN_URL ??
  'postgres://letsgo:letsgo@127.0.0.1:5432/postgres';

let n = 0;

/**
 * Every suite boots the app against its own empty Postgres database, so
 * migrations run from scratch each time, exactly as on a new install.
 */
export async function freshDatabase(): Promise<string> {
  const name = `letsgo_test_${process.pid}_${++n}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.toString();
  return process.env.DATABASE_URL;
}
