import { spawn } from 'child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { createGzip } from 'zlib';
import { dataDir } from '../common/paths';
import { databaseOptions } from './database.config';
import { postgresBin } from './embedded-postgres';

const KEEP = 10;

/**
 * Before an update changes the database (pending migrations), save a snapshot
 * to <DATA_DIR>/backups/letsgo-<date>.sql.gz and keep the last ten. Updates
 * through Unraid's update button get the same safety net as the deploy line.
 */
export async function backupBeforeUpgrade(): Promise<string | null> {
  const ds = new DataSource({ ...databaseOptions(), migrationsRun: false });
  await ds.initialize();
  let pending = false;
  try {
    const [{ t }] = await ds.query<{ t: string | null }[]>(
      `SELECT to_regclass('public.trip') AS t`,
    );
    if (!t) return null; // brand-new database: nothing to keep yet
    pending = await ds.showMigrations();
  } finally {
    await ds.destroy();
  }
  if (!pending) return null;

  const dump = postgresBin('pg_dump');
  if (!existsSync(dump)) {
    console.warn(`[backup] ${dump} not found; skipping the snapshot`);
    return null;
  }
  const dir = join(dataDir(), 'backups');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\..*/, '')
    .replace('T', '-');
  const file = join(dir, `letsgo-${stamp}.sql.gz`);
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      dump,
      ['--no-owner', '--dbname', process.env.DATABASE_URL ?? ''],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let err = '';
    p.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const out = createWriteStream(file);
    p.stdout.pipe(createGzip()).pipe(out);
    p.once('error', reject);
    p.once('exit', (code) => {
      if (code === 0) out.once('finish', () => resolve());
      else reject(new Error(`pg_dump failed (${code}): ${err.trim()}`));
    });
  });
  const old = readdirSync(dir)
    .filter((f) => /^letsgo-.*\.sql\.gz$/.test(f))
    .sort()
    .reverse()
    .slice(KEEP);
  for (const f of old) rmSync(join(dir, f), { force: true });
  console.log(`[backup] Saved a database snapshot before updating: ${file}`);
  return file;
}
