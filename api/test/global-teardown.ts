import { Client } from 'pg';
import { ADMIN_URL } from './db';

/** Drop every throwaway test database. */
export default async function teardown(): Promise<void> {
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    const { rows } = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'letsgo_test_%'`,
    );
    for (const r of rows)
      await admin.query(`DROP DATABASE IF EXISTS ${r.datname} WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
