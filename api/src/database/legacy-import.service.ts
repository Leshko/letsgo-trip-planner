import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { DataSource, EntityManager, EntityMetadata } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { LegacyImport, Trip } from '../entities';
import { legacySqlitePath } from '../common/paths';

const MARKER_ID = 'sqlite';
const CHUNK = 200;

export type ImportResult =
  | { status: 'no-file' | 'already-imported' | 'skipped-nonempty' }
  | {
      status: 'imported';
      counts: Record<string, number>;
      skippedOrphans: Record<string, number>;
    };

/**
 * One-time copy of the SQLite database used by earlier versions into Postgres.
 *
 * - Runs on startup, after migrations, before the app serves anything.
 * - Everything happens in one transaction: either every row lands and the
 *   per-table counts match, or nothing is written and the app refuses to start.
 * - The SQLite file is opened read-only and never changed or deleted, so the
 *   previous version can still be run against it.
 * - IDs, sign-in tokens, timestamps and settings are copied exactly, so
 *   browsers stay signed in and push subscriptions keep working.
 */
@Injectable()
export class LegacyImportService implements OnModuleInit {
  private readonly log = new Logger('LegacyImport');

  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async onModuleInit(): Promise<void> {
    const r = await this.run();
    if (r.status === 'imported') {
      const summary = Object.entries(r.counts)
        .map(([t, n]) => `${t}=${n}`)
        .join(' ');
      this.log.log(`Imported the old SQLite database: ${summary}`);
      const orphans = Object.entries(r.skippedOrphans);
      if (orphans.length)
        this.log.warn(
          `Skipped rows that pointed at already-deleted records: ${orphans.map(([t, n]) => `${t}=${n}`).join(' ')}`,
        );
    } else if (r.status === 'skipped-nonempty') {
      this.log.warn(
        `Found ${legacySqlitePath()} but Postgres already has trips, so it was not imported again.`,
      );
    }
  }

  async run(path = legacySqlitePath()): Promise<ImportResult> {
    if (!existsSync(path)) return { status: 'no-file' };
    if (
      await this.ds
        .getRepository(LegacyImport)
        .exists({ where: { id: MARKER_ID } })
    )
      return { status: 'already-imported' };
    if ((await this.ds.getRepository(Trip).count()) > 0)
      return { status: 'skipped-nonempty' };

    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      return await this.ds.transaction(async (m) => {
        const counts: Record<string, number> = {};
        const skippedOrphans: Record<string, number> = {};
        const imported = new Map<string, Set<string>>();
        for (const meta of this.ordered()) {
          const { rows, orphans } = this.readTable(db, meta, imported);
          await this.insert(m, meta, rows);
          const [{ n }] = await m.query<{ n: string }[]>(
            `SELECT count(*) AS n FROM "${meta.tableName}"`,
          );
          if (Number(n) !== rows.length)
            throw new Error(
              `Import check failed for ${meta.tableName}: expected ${rows.length} rows, found ${n}`,
            );
          counts[meta.tableName] = rows.length;
          if (orphans) skippedOrphans[meta.tableName] = orphans;
          const pk = meta.primaryColumns[0]?.databaseName;
          if (pk)
            imported.set(
              meta.tableName,
              new Set(rows.map((r) => asText(r[pk]))),
            );
        }
        await m.getRepository(LegacyImport).insert({
          id: MARKER_ID,
          importedAt: Date.now(),
          source: path,
          counts,
        });
        return { status: 'imported' as const, counts, skippedOrphans };
      });
    } finally {
      db.close();
    }
  }

  /** Parents before children, following foreign keys. */
  private ordered(): EntityMetadata[] {
    const metas = this.ds.entityMetadatas.filter(
      (m) => m.target !== LegacyImport && m.tableType === 'regular',
    );
    const done = new Set<string>();
    const out: EntityMetadata[] = [];
    while (out.length < metas.length) {
      const before = out.length;
      for (const m of metas) {
        if (done.has(m.tableName)) continue;
        const deps = m.foreignKeys
          .map((fk) => fk.referencedEntityMetadata.tableName)
          .filter((t) => t !== m.tableName);
        if (deps.every((d) => done.has(d))) {
          out.push(m);
          done.add(m.tableName);
        }
      }
      if (out.length === before)
        throw new Error('Circular foreign keys; cannot order the import');
    }
    return out;
  }

  private readTable(
    db: Database.Database,
    meta: EntityMetadata,
    imported: Map<string, Set<string>>,
  ): { rows: Record<string, unknown>[]; orphans: number } {
    const exists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(meta.tableName);
    if (!exists) return { rows: [], orphans: 0 };
    const present = new Set(
      (
        db.prepare(`PRAGMA table_info("${meta.tableName}")`).all() as {
          name: string;
        }[]
      ).map((c) => c.name),
    );
    const cols = meta.columns.filter((c) => present.has(c.databaseName));
    const raw = db
      .prepare(
        `SELECT ${cols.map((c) => `"${c.databaseName}"`).join(', ')} FROM "${meta.tableName}"`,
      )
      .all() as Record<string, unknown>[];

    let orphans = 0;
    const rows: Record<string, unknown>[] = [];
    for (const r of raw) {
      const row: Record<string, unknown> = {};
      for (const c of cols) row[c.databaseName] = convert(c, r[c.databaseName]);
      let keep = true;
      for (const fk of meta.foreignKeys) {
        const col = fk.columnNames[0];
        const v = row[col];
        if (v === null || v === undefined) continue;
        const parents = imported.get(fk.referencedEntityMetadata.tableName);
        if (parents?.has(asText(v))) continue;
        // The parent is gone. SQLite would have cascaded or nulled this row; do the same.
        if (fk.onDelete === 'SET NULL') row[col] = null;
        else keep = false;
      }
      if (keep) rows.push(row);
      else orphans++;
    }
    return { rows, orphans };
  }

  private async insert(
    m: EntityManager,
    meta: EntityMetadata,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const list = cols.map((c) => `"${c}"`).join(', ');
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const params: unknown[] = [];
      const values = chunk
        .map(
          (r) =>
            `(${cols
              .map((c) => {
                params.push(r[c]);
                return `$${params.length}`;
              })
              .join(', ')})`,
        )
        .join(', ');
      await m.query(
        `INSERT INTO "${meta.tableName}" (${list}) VALUES ${values}`,
        params,
      );
    }
  }
}

function typeName(c: ColumnMetadata): string {
  return typeof c.type === 'function'
    ? c.type.name.toLowerCase()
    : String(c.type).toLowerCase();
}

/** SQLite stores booleans as 0/1 and everything loosely; Postgres wants exact types. */
function convert(c: ColumnMetadata, v: unknown): unknown {
  const t = typeName(c);
  if (v === null || v === undefined) {
    if (c.isNullable) return null;
    if (c.default !== undefined && typeof c.default !== 'function')
      return c.default;
    if (t === 'bigint' || t === 'integer' || t === 'number')
      return c.propertyName === 'createdAt' ? Date.now() : 0;
    if (t === 'boolean') return false;
    return '';
  }
  switch (t) {
    case 'boolean':
      return v === 1 || v === true || v === '1' || v === 'true';
    case 'bigint':
    case 'integer':
    case 'int':
    case 'number':
      return Number(v);
    case 'bytea':
      return Buffer.isBuffer(v) ? v : Buffer.from(v as Uint8Array);
    default:
      return asText(v);
  }
}

/** SQLite hands back strings, numbers or bigints for text-ish columns. */
function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean')
    return v.toString();
  return JSON.stringify(v);
}
