import { Database } from "bun:sqlite";
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
  rowToEntry,
  type EntryRow,
  type SqlParam,
} from "@opencms/sqlite-dialect";

/**
 * DataConnector for SQLite via bun:sqlite (the self-hosted profile).
 *
 * All SQL comes from @opencms/sqlite-dialect, shared verbatim with the
 * Cloudflare D1 connector. Fixed schema, no runtime DDL except CREATE INDEX:
 * fields flagged `indexed` get a composite (type, json_extract) expression
 * index so filtered queries are B-tree lookups.
 */
export interface SQLiteConnectorOptions {
  /** File path or ":memory:" (default). */
  path?: string;
}

export class SQLiteDataConnector implements DataConnector {
  /** Escape hatch for advanced callers and tests (EXPLAIN etc). */
  readonly db: Database;

  constructor(opts: SQLiteConnectorOptions = {}) {
    this.db = new Database(opts.path ?? ":memory:");
    this.db.run("PRAGMA journal_mode = WAL");
  }

  async init(): Promise<void> {
    for (const sql of INIT_STATEMENTS) this.db.run(sql);
  }

  // Content types -------------------------------------------------------------

  async listTypes(): Promise<ContentTypeDef[]> {
    const rows = this.db
      .query<{ definition: string }, []>("SELECT definition FROM content_types ORDER BY name")
      .all();
    return rows.map((r) => JSON.parse(r.definition) as ContentTypeDef);
  }

  async getType(name: string): Promise<ContentTypeDef | null> {
    const row = this.db
      .query<{ definition: string }, [string]>(
        "SELECT definition FROM content_types WHERE name = ?"
      )
      .get(name);
    return row ? (JSON.parse(row.definition) as ContentTypeDef) : null;
  }

  async saveType(def: ContentTypeDef): Promise<void> {
    this.db
      .query(
        `INSERT INTO content_types (name, definition) VALUES (?, ?)
         ON CONFLICT(name) DO UPDATE SET definition = excluded.definition`
      )
      .run(def.name, JSON.stringify(def));
  }

  async deleteType(name: string): Promise<void> {
    for (const idx of this.listFieldIndexes(name)) this.db.run(dropIndexSql(idx));
    this.db.query("DELETE FROM entries WHERE type = ?").run(name);
    this.db.query("DELETE FROM content_types WHERE name = ?").run(name);
  }

  private listFieldIndexes(type: string): string[] {
    const rows = this.db
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE ?"
      )
      .all("idx_e_%");
    // LIKE treats _ as a wildcard; filter precisely in JS instead.
    return rows.map((r) => r.name).filter((n) => n.startsWith(`idx_e_${type}_`));
  }

  /**
   * Composite (type, json_extract) expression indexes for fields flagged
   * `indexed`. Stale indexes for fields no longer flagged are dropped.
   * The only DDL that ever runs after init.
   */
  async ensureIndexes(def: ContentTypeDef): Promise<void> {
    const wanted = new Map<string, string>();
    for (const f of def.fields) {
      if (f.indexed) wanted.set(indexName(def.name, f.name), f.name);
    }
    for (const existing of this.listFieldIndexes(def.name)) {
      if (!wanted.has(existing)) this.db.run(dropIndexSql(existing));
    }
    for (const [idx, field] of wanted) {
      this.db.run(createIndexSql(idx, field));
    }
  }

  // Entries ---------------------------------------------------------------------

  async insertEntry(entry: Entry): Promise<void> {
    this.db
      .query(
        `INSERT INTO entries (id, type, slug, status, data, created_at, updated_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.id,
        entry.type,
        entry.slug,
        entry.status,
        JSON.stringify(entry.data),
        entry.createdAt,
        entry.updatedAt,
        entry.publishedAt
      );
  }

  async updateEntry(entry: Entry): Promise<void> {
    this.db
      .query(
        `UPDATE entries SET slug = ?, status = ?, data = ?, created_at = ?, updated_at = ?, published_at = ?
         WHERE type = ? AND id = ?`
      )
      .run(
        entry.slug,
        entry.status,
        JSON.stringify(entry.data),
        entry.createdAt,
        entry.updatedAt,
        entry.publishedAt,
        entry.type,
        entry.id
      );
  }

  async getEntryById(type: string, id: string): Promise<Entry | null> {
    const row = this.db
      .query<EntryRow, [string, string]>("SELECT * FROM entries WHERE type = ? AND id = ?")
      .get(type, id);
    return row ? rowToEntry(row) : null;
  }

  async getEntryBySlug(type: string, slug: string): Promise<Entry | null> {
    const row = this.db
      .query<EntryRow, [string, string]>("SELECT * FROM entries WHERE type = ? AND slug = ?")
      .get(type, slug);
    return row ? rowToEntry(row) : null;
  }

  async deleteEntry(type: string, id: string): Promise<void> {
    this.db.query("DELETE FROM entries WHERE type = ? AND id = ?").run(type, id);
  }

  async queryEntries(type: string, query: EntryQuery): Promise<QueryResult<Entry>> {
    const where = buildWhere(type, query.filter ?? []);
    const sort: Sort[] =
      query.sort && query.sort.length > 0
        ? query.sort
        : [{ field: "createdAt", dir: "desc" }];
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const items = this.db
      .query<EntryRow, SqlParam[]>(
        `SELECT * FROM entries WHERE ${where.sql} ORDER BY ${buildOrderBy(sort)} LIMIT ? OFFSET ?`
      )
      .all(...where.params, limit, offset)
      .map(rowToEntry);

    const totalRow = this.db
      .query<{ n: number }, SqlParam[]>(
        `SELECT COUNT(*) AS n FROM entries WHERE ${where.sql}`
      )
      .get(...where.params);

    return { items, total: totalRow?.n ?? 0, limit, offset };
  }

  async countEntries(type: string): Promise<number> {
    const row = this.db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM entries WHERE type = ?")
      .get(type);
    return row?.n ?? 0;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
