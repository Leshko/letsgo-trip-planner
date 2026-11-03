import { ChildProcess, execFile, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import { promisify } from 'util';
import { dataDir } from '../common/paths';

const exec = promisify(execFile);

export interface EmbeddedPostgres {
  url: string;
  stop(): Promise<void>;
  /** Called if PostgreSQL stops without being asked to. */
  onUnexpectedExit(cb: (code: number | null) => void): void;
}

export function postgresBin(name: string): string {
  return join(process.env.PG_BIN || '/usr/lib/postgresql/16/bin', name);
}

/**
 * The database that ships inside the LetsGo container (used when DATABASE_URL
 * isn't set). Its files live in <DATA_DIR>/db next to the photos, so the
 * container's one data folder is the whole backup, and Unraid's update button
 * is all an upgrade needs. It only listens inside the container.
 */
export async function startEmbeddedPostgres(): Promise<EmbeddedPostgres> {
  const dir = join(dataDir(), 'db');
  const pwFile = join(dataDir(), 'db.password');
  const port = Number(process.env.EMBEDDED_PG_PORT || 5432);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  } catch (e) {
    throw new Error(
      `Can't write to the data folder (${dataDir()}): ${String(e)}. On Unraid run: chown -R 1000:1000 /mnt/user/appdata/letsgo`,
    );
  }

  if (!existsSync(join(dir, 'PG_VERSION'))) {
    console.log('[database] Creating the built-in database');
    writeFileSync(pwFile, randomBytes(24).toString('base64url') + '\n', {
      mode: 0o600,
    });
    await exec(postgresBin('initdb'), [
      '-D',
      dir,
      '-U',
      'letsgo',
      `--pwfile=${pwFile}`,
      '--auth=scram-sha-256',
      '-E',
      'UTF8',
      '--locale=C',
    ]);
  }
  if (!existsSync(pwFile))
    throw new Error(
      `The built-in database exists but ${pwFile} is missing, so it can't be opened.`,
    );
  const password = readFileSync(pwFile, 'utf8').trim();

  // Nothing else can be using this folder while the container starts; a pid file
  // left by a power cut would otherwise stop PostgreSQL from starting.
  rmSync(join(dir, 'postmaster.pid'), { force: true });

  const child: ChildProcess = spawn(
    postgresBin('postgres'),
    [
      '-D',
      dir,
      '-c',
      'listen_addresses=127.0.0.1',
      '-c',
      `port=${port}`,
      '-c',
      'unix_socket_directories=',
      '-c',
      'max_connections=40',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const tail: string[] = [];
  const relay = (chunk: Buffer) => {
    for (const line of chunk.toString().split('\n')) {
      if (!line.trim()) continue;
      tail.push(line);
      if (tail.length > 40) tail.shift();
      if (/ERROR|FATAL|PANIC|WARNING|ready to accept|shut down/.test(line))
        console.log(`[postgres] ${line}`);
    }
  };
  child.stdout?.on('data', relay);
  child.stderr?.on('data', relay);

  let exited = false;
  let stopping = false;
  let onUnexpected: ((code: number | null) => void) | null = null;
  const exitPromise = new Promise<number | null>((resolve) =>
    child.once('exit', (code) => {
      exited = true;
      if (!stopping) onUnexpected?.(code);
      resolve(code);
    }),
  );

  const admin = (database: string) =>
    new Client({
      host: '127.0.0.1',
      port,
      user: 'letsgo',
      password,
      database,
    });

  // Wait until it accepts connections (crash recovery after a power cut can take a moment).
  const deadline = Date.now() + 120_000;
  for (;;) {
    if (exited)
      throw new Error(
        `The built-in database didn't start:\n${tail.slice(-15).join('\n')}`,
      );
    const c = admin('postgres');
    try {
      await c.connect();
      const r = await c.query(
        `SELECT 1 FROM pg_database WHERE datname = 'letsgo'`,
      );
      if (!r.rowCount) await c.query('CREATE DATABASE letsgo');
      await c.end();
      break;
    } catch (e) {
      await c.end().catch(() => undefined);
      if (Date.now() > deadline) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return {
    url: `postgres://letsgo:${encodeURIComponent(password)}@127.0.0.1:${port}/letsgo`,
    onUnexpectedExit(cb) {
      onUnexpected = cb;
    },
    async stop() {
      if (exited) return;
      stopping = true;
      child.kill('SIGINT'); // "fast" shutdown: finish cleanly, don't wait for clients
      const timer = setTimeout(() => child.kill('SIGQUIT'), 20_000);
      await exitPromise;
      clearTimeout(timer);
    },
  };
}
