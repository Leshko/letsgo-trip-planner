import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

let testDataDir: string | null = null;

/**
 * Where files live (photos, push keys, the old SQLite file). DATA_DIR wins;
 * older deploys only set DB_PATH, so its folder is used next; then ./data.
 */
export function dataDir(): string {
  let dir = process.env.DATA_DIR;
  if (!dir && process.env.DB_PATH && process.env.DB_PATH !== ':memory:')
    dir = dirname(process.env.DB_PATH);
  if (!dir && process.env.JEST_WORKER_ID) {
    // Tests: a throwaway directory per process.
    if (!testDataDir)
      testDataDir = join(tmpdir(), `letsgo-test-${process.pid}`);
    dir = testDataDir;
  }
  dir = dir ?? join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** The SQLite file earlier versions stored everything in; read once by the importer. */
export function legacySqlitePath(): string {
  const p = process.env.DB_PATH;
  if (p && p !== ':memory:') return p;
  return join(dataDir(), 'letsgo.sqlite');
}

export function photosDir(): string {
  const p = join(dataDir(), 'photos');
  mkdirSync(p, { recursive: true });
  return p;
}

export function photosTmpDir(): string {
  const p = join(photosDir(), 'tmp');
  mkdirSync(p, { recursive: true });
  return p;
}
