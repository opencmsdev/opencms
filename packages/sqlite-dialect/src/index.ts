import type { Entry, Filter, Sort } from "@opencms/core";

/**
 * The SQLite dialect shared by every SQLite-family connector: bun:sqlite
 * (self-hosted) and Cloudflare D1. Pure functions, no driver imports, so it
 * runs in any runtime including workerd.
 *
 * Everything here produces parameterized SQL; values never interpolate into
 * the string. The only identifiers that do are validated by assertSafeName.
 */

export const SYSTEM_COLUMNS: Record<string, string> = {
  id: "id",
  slug: "slug",
  status: "status",
  createdAt: "created_at",
  updatedAt: "updated_at",
  publishedAt: "published_at",
};

const SAFE_NAME = /^[a-zA-Z0-9_]+$/;

export function assertSafeName(name: string): string {
  if (!SAFE_NAME.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return name;
}

/** SQL expression addressing a queryable field. */
export function fieldExpr(field: string): string {
  const col = SYSTEM_COLUMNS[field];
  if (col) return col;
  assertSafeName(field);
  return `json_extract(data, '$.${field}')`;
}

/** JS filter values to SQLite-comparable values (booleans become 0/1). */
export function sqlValue(v: unknown): string | number | null {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  if (v === null || v === undefined) return null;
  return String(v);
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export type SqlParam = string | number | null;

export interface Where {
  sql: string;
  params: SqlParam[];
}

export function buildWhere(type: string, filters: Filter[]): Where {
  const clauses: string[] = ["type = ?"];
  const params: SqlParam[] = [type];

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
        if (values.length === 0) {
          clauses.push(f.op === "in" ? "0" : "1");
          break;
        }
        const marks = values.map(() => "?").join(", ");
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

export function buildOrderBy(sort: Sort[]): string {
  const parts = sort.map((s) => {
    const dir = s.dir === "desc" ? "DESC" : "ASC";
    return `${fieldExpr(s.field)} ${dir}`;
  });
  parts.push("id ASC"); // stable tiebreaker for deterministic pagination
  return parts.join(", ");
}

export interface EntryRow {
  id: string;
  type: string;
  slug: string;
  status: string;
  data: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export function rowToEntry(row: EntryRow): Entry {
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

/** Fixed schema. Idempotent; the only DDL besides ensureIndexes. */
export const INIT_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS content_types (
    name TEXT PRIMARY KEY,
    definition TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS entries (
    id TEXT NOT NULL,
    type TEXT NOT NULL,
    slug TEXT NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    published_at TEXT,
    PRIMARY KEY (type, id)
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_type_slug ON entries(type, slug)",
  "CREATE INDEX IF NOT EXISTS idx_entries_type_status_created ON entries(type, status, created_at)",
];

export function indexName(type: string, field: string): string {
  return `idx_e_${assertSafeName(type)}_${assertSafeName(field)}`;
}

export function createIndexSql(idx: string, field: string): string {
  return `CREATE INDEX IF NOT EXISTS "${assertSafeName(idx)}" ON entries(type, json_extract(data, '$.${assertSafeName(field)}'))`;
}

export function dropIndexSql(idx: string): string {
  return `DROP INDEX IF EXISTS "${assertSafeName(idx)}"`;
}
