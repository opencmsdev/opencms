import { Database } from "bun:sqlite";
import type {
  ContentTypeDef,
  DataConnector,
  Entry,
  EntryQuery,
  Filter,
  QueryResult,
  Sort,
} from "@opencms/core";

/**
 * DataConnector for SQLite via bun:sqlite.
 *
 * Fixed schema, no runtime DDL except CREATE INDEX. Typed payloads live in a
 * JSON column; fields flagged `indexed` get a composite (type, json_extract)
 * expression index so filtered queries are B-tree lookups. The identical
 * SQL dialect runs on Cloudflare D1, which is the next connector.
 */

const SYSTEM_COLUMNS: Record<string, string> = {
  id: "id",
  slug: "slug",
  status: "status",
  createdAt: "created_at",
  updatedAt: "updated_at",
  publishedAt: "published_at",
};

const SAFE_NAME = /^[a-zA-Z0-9_]+$/;

function assertSafeName(name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return name;
}

/** SQL expression addressing a queryable field. */
function fieldExpr(field: string): string {
  const col = SYSTEM_COLUMNS[field];
  if (col) return col;
  assertSafeName(field);
  return `json_extract(data, '$.${field}')`;
}

/** JS filter values to SQLite-comparable values (booleans become 0/1). */
function sqlValue(v: unknown): string | number | null {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  if (v === null || v === undefined) return null;
  return String(v);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

interface Where {
  sql: string;
  params: (string | number | null)[];
}

function buildWhere(type: string, filters: Filter[]): Where {
  const clauses: string[] = ["type = ?"];
  const params: (string | number | null)[] = [type];

  for (const f of filters) {
    const expr = fieldExpr(f.field);
    switch (f.op) {
      case "eq":
        clauses.push(`${expr} = ?`);
        params.push(sqlValue(f.value));
        break;
      case "ne":
        clauses.push(`(${expr} IS NULL OR ${expr} <> ?)`);
        params.push(sqlValue(f.value));
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte": {
        const op = { lt: "<", lte: "<=", gt: ">", gte: ">=" }[f.op];
        clauses.push(`${expr} ${op} ?`);
        params.push(sqlValue(f.value));
        break;
      }
      case "in":
      case "nin": {
        const values = Array.isArray(f.value) ? f.value : [];
        const marks = values.map(() => "?").join(", ");
        if (values.length === 0) {
          clauses.push(f.op === "in" ? "0" : "1");
          break;
        }
        if (f.op === "in") {
          clauses.push(`${expr} IN (${marks})`);
        } else {
          clauses.push(`(${expr} IS NULL OR ${expr} NOT IN (${marks}))`);
        }
        params.push(...values.map(sqlValue));
        break;
      }
      case "contains":
        clauses.push(`${expr} LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(String(f.value ?? ""))}%`);
        break;
      case "exists":
        clauses.push(f.value === false ? `${expr} IS NULL` : `${expr} IS NOT NULL`);
        break;
    }
  }
  return { sql: clauses.join(" AND "), params };
}

function buildOrderBy(sort: Sort[]): string {
  const parts = sort.map((s) => {
    const dir = s.dir === "desc" ? "DESC" : "ASC";
    return `${fieldExpr(s.field)} ${dir}`;
  });
  parts.push("id ASC"); // stable tiebreaker for deterministic pagination
  return parts.join(", ");
}

interface EntryRow {
  id: string;
  type: string;
  slug: string;
  status: string;
  data: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

function rowToEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    type: row.type,
    slug: row.slug,
    status: row.status as Entry["status"],
    data: JSON.parse(row.data) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

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
    this.db.run(`
      CREATE TABLE IF NOT EXISTS content_types (
        name TEXT PRIMARY KEY,
        definition TEXT NOT NULL
      )
    `);
    this.db.run(`
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        slug TEXT NOT NULL,
        status TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT,
        PRIMARY KEY (type, id)
      )
    `);
    this.db.run(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_type_slug ON entries(type, slug)"
    );
    this.db.run(
      "CREATE INDEX IF NOT EXISTS idx_entries_type_status_created ON entries(type, status, created_at)"
    );
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
    this.dropFieldIndexes(name);
    this.db.query("DELETE FROM entries WHERE type = ?").run(name);
    this.db.query("DELETE FROM content_types WHERE name = ?").run(name);
  }

  private indexName(type: string, field: string): string {
    return `idx_e_${assertSafeName(type)}_${assertSafeName(field)}`;
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

  private dropFieldIndexes(type: string): void {
    for (const name of this.listFieldIndexes(type)) {
      this.db.run(`DROP INDEX IF EXISTS "${assertSafeName(name)}"`);
    }
  }

  /**
   * Composite (type, json_extract) expression indexes for fields flagged
   * `indexed`. Stale indexes for fields no longer flagged are dropped.
   * The only DDL that ever runs after init.
   */
  async ensureIndexes(def: ContentTypeDef): Promise<void> {
    const wanted = new Map<string, string>();
    for (const f of def.fields) {
      if (f.indexed) wanted.set(this.indexName(def.name, f.name), f.name);
    }
    for (const existing of this.listFieldIndexes(def.name)) {
      if (!wanted.has(existing)) this.db.run(`DROP INDEX IF EXISTS "${existing}"`);
    }
    for (const [idx, field] of wanted) {
      this.db.run(
        `CREATE INDEX IF NOT EXISTS "${idx}" ON entries(type, json_extract(data, '$.${assertSafeName(field)}'))`
      );
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
      .query<EntryRow, (string | number | null)[]>(
        `SELECT * FROM entries WHERE ${where.sql} ORDER BY ${buildOrderBy(sort)} LIMIT ? OFFSET ?`
      )
      .all(...where.params, limit, offset)
      .map(rowToEntry);

    const totalRow = this.db
      .query<{ n: number }, (string | number | null)[]>(
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
