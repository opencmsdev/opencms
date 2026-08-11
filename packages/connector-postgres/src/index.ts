import { SQL } from "bun";
import type {
  ContentTypeDef,
  DataConnector,
  Entry,
  EntryQuery,
  QueryResult,
  Sort,
} from "@opencms/core";
import {
  INIT_STATEMENTS,
  buildOrderBy,
  buildWhere,
  createIndexSql,
  dropIndexSql,
  indexName,
  type EntryRow,
  type SqlParam,
} from "./dialect.ts";

/**
 * DataConnector for Postgres via Bun's built-in SQL client. Zero external
 * dependencies, matching the bun:sqlite connector's posture.
 *
 * One connector covers anything that speaks the Postgres wire protocol:
 * self-hosted Postgres, Supabase, Neon, RDS. Pass the provider's connection
 * string and everything else is identical.
 *
 * Entry data lives in a `jsonb` column with typed comparisons; see dialect.ts
 * for how each SQLite behaviour maps. Runs on Bun (the self-hosted profile);
 * Workers deployments keep using D1.
 */
export interface PostgresConnectorOptions {
  /** e.g. postgres://user:pass@host:5432/db - Supabase and Neon strings work as-is. */
  url: string;
  /** Pool size. Bun's default is used when unset. */
  max?: number;
}

export class PostgresDataConnector implements DataConnector {
  /** Escape hatch for advanced callers and tests (EXPLAIN etc). */
  readonly db: SQL;

  constructor(opts: PostgresConnectorOptions) {
    this.db = new SQL({ url: opts.url, ...(opts.max ? { max: opts.max } : {}) });
  }

  private async run<T = Record<string, unknown>>(
    sql: string,
    params: SqlParam[] = []
  ): Promise<T[]> {
    return (await this.db.unsafe(sql, params as never[])) as T[];
  }

  async init(): Promise<void> {
    for (const sql of INIT_STATEMENTS) await this.run(sql);
  }

  // Content types -------------------------------------------------------------

  async listTypes(): Promise<ContentTypeDef[]> {
    const rows = await this.run<{ definition: string }>(
      "SELECT definition FROM content_types ORDER BY name"
    );
    return rows.map((r) => JSON.parse(r.definition) as ContentTypeDef);
  }

  async getType(name: string): Promise<ContentTypeDef | null> {
    const rows = await this.run<{ definition: string }>(
      "SELECT definition FROM content_types WHERE name = $1",
      [name]
    );
    return rows[0] ? (JSON.parse(rows[0].definition) as ContentTypeDef) : null;
  }

  async saveType(def: ContentTypeDef): Promise<void> {
    await this.run(
      `INSERT INTO content_types (name, definition) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET definition = EXCLUDED.definition`,
      [def.name, JSON.stringify(def)]
    );
  }

  async deleteType(name: string): Promise<void> {
    for (const idx of await this.listFieldIndexes(name)) {
      await this.run(dropIndexSql(idx));
    }
    await this.run("DELETE FROM entries WHERE type = $1", [name]);
    await this.run("DELETE FROM content_types WHERE name = $1", [name]);
  }

  private async listFieldIndexes(type: string): Promise<string[]> {
    const rows = await this.run<{ indexname: string }>(
      // LIKE treats _ as a wildcard; filter precisely in JS instead.
      "SELECT indexname FROM pg_indexes WHERE tablename = 'entries' AND indexname LIKE 'idx_e_%'"
    );
    return rows.map((r) => r.indexname).filter((n) => n.startsWith(`idx_e_${type}_`));
  }

  /**
   * Composite (type, jsonb expression) indexes for fields flagged `indexed`.
   * Stale indexes for fields no longer flagged are dropped. The only DDL that
   * ever runs after init.
   */
  async ensureIndexes(def: ContentTypeDef): Promise<void> {
    const wanted = new Map<string, string>();
    for (const f of def.fields) {
      if (f.indexed) wanted.set(indexName(def.name, f.name), f.name);
    }
    for (const existing of await this.listFieldIndexes(def.name)) {
      if (!wanted.has(existing)) await this.run(dropIndexSql(existing));
    }
    for (const [idx, field] of wanted) {
      await this.run(createIndexSql(idx, field));
    }
  }

  // Entries ---------------------------------------------------------------------

  async insertEntry(entry: Entry): Promise<void> {
    await this.run(
      `INSERT INTO entries (id, type, slug, status, data, created_at, updated_at, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.id,
        entry.type,
        entry.slug,
        entry.status,
        // The object itself: Bun's driver sends it as jsonb. Serializing it
        // here would store a JSON *string* of the object (see dialect.ts).
        entry.data as never,
        entry.createdAt,
        entry.updatedAt,
        entry.publishedAt,
      ]
    );
  }

  async updateEntry(entry: Entry): Promise<void> {
    await this.run(
      `UPDATE entries SET slug = $1, status = $2, data = $3, created_at = $4, updated_at = $5, published_at = $6
       WHERE type = $7 AND id = $8`,
      [
        entry.slug,
        entry.status,
        entry.data as never,
        entry.createdAt,
        entry.updatedAt,
        entry.publishedAt,
        entry.type,
        entry.id,
      ]
    );
  }

  async getEntryById(type: string, id: string): Promise<Entry | null> {
    const rows = await this.run<EntryRow>(
      "SELECT * FROM entries WHERE type = $1 AND id = $2",
      [type, id]
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
  }

  async getEntryBySlug(type: string, slug: string): Promise<Entry | null> {
    const rows = await this.run<EntryRow>(
      "SELECT * FROM entries WHERE type = $1 AND slug = $2",
      [type, slug]
    );
    return rows[0] ? rowToEntry(rows[0]) : null;
  }

  async deleteEntry(type: string, id: string): Promise<void> {
    await this.run("DELETE FROM entries WHERE type = $1 AND id = $2", [type, id]);
  }

  async queryEntries(type: string, query: EntryQuery): Promise<QueryResult<Entry>> {
    const where = buildWhere(type, query.filter ?? []);
    const sort: Sort[] =
      query.sort && query.sort.length > 0
        ? query.sort
        : [{ field: "createdAt", dir: "desc" }];
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const n = where.params.length;
    const items = (
      await this.run<EntryRow>(
        `SELECT * FROM entries WHERE ${where.sql} ORDER BY ${buildOrderBy(sort)} LIMIT $${n + 1} OFFSET $${n + 2}`,
        [...where.params, limit, offset]
      )
    ).map(rowToEntry);

    const totalRows = await this.run<{ n: number | string }>(
      `SELECT COUNT(*) AS n FROM entries WHERE ${where.sql}`,
      where.params
    );
    // COUNT(*) is bigint; drivers surface it as a string.
    const total = Number(totalRows[0]?.n ?? 0);

    return { items, total, limit, offset };
  }

  async countEntries(type: string): Promise<number> {
    const rows = await this.run<{ n: number | string }>(
      "SELECT COUNT(*) AS n FROM entries WHERE type = $1",
      [type]
    );
    return Number(rows[0]?.n ?? 0);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

function rowToEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    type: row.type,
    slug: row.slug,
    status: row.status as Entry["status"],
    data:
      typeof row.data === "string"
        ? (JSON.parse(row.data) as Record<string, unknown>)
        : row.data,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}
