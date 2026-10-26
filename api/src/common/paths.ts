import { mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

/**
 * Where data lives. DB_PATH names the SQLite file; everything else (photos)
 * sits next to it so one volume (/data in Docker) is the whole backup.
 */
export function databasePath(): string {
  const p = process.env.DB_PATH ?? join(process.cwd(), 'data', 'letsgo.sqlite');
  if (p !== ':memory:') mkdirSync(dirname(p), { recursive: true });
  return p;
}

let memoryDataDir: string | null = null;

export function dataDir(): string {
  const db = databasePath();
  if (db !== ':memory:') return dirname(db);
  // Tests: a throwaway directory per process.
  if (!memoryDataDir)
    memoryDataDir = join(tmpdir(), `letsgo-test-${process.pid}`);
  mkdirSync(memoryDataDir, { recursive: true });
  return memoryDataDir;
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
