import type { Filter, Sort } from "@opencms/core";

/**
 * The Postgres dialect. It mirrors @opencms/sqlite-dialect's shape but is its
 * own module rather than a shared package, because only one connector speaks
 * it; extract it the day a second Postgres-family connector exists.
 *
 * The semantic differences from SQLite, and how they are bridged so the
 * conformance suite sees identical behaviour:
 *
 * - Entry data lives in a `jsonb` column. Field comparisons go through
 *   `data->'field' <op> $n::jsonb`, because jsonb comparison is typed the way
 *   SQLite's `json_extract` results are: numbers compare numerically, strings
 *   as text, booleans as booleans. Comparing `->>'` text would sort 10 < 9.
 * - `contains` and everything LIKE-shaped uses `->>` (text extraction).
 * - Placeholders are numbered `$1..$n`, so the builder carries a counter.
 * - SQLite sorts NULL first ascending; Postgres sorts it last. `NULLS FIRST` /
 *   `NULLS LAST` pins Postgres to SQLite's order.
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

/** jsonb expression for a data field (typed comparisons, ordering). */
function jsonExpr(field: string): string {
  return `data->'${assertSafeName(field)}'`;
}

/** text expression for a data field (LIKE, existence). */
function textExpr(field: string): string {
  return `data->>'${assertSafeName(field)}'`;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export type SqlParam = string | number | null;

export interface Where {
  sql: string;
  params: SqlParam[];
}

/** Numbered-placeholder builder; `start` supports appending after prior params. */
class Params {
  readonly values: SqlParam[] = [];
  constructor(private offset = 0) {}
  add(v: SqlParam): string {
    this.values.push(v);
    return `$${this.offset + this.values.length}`;
  }
}

/** A filter value as it goes into a `::jsonb` comparison parameter. */
function jsonbParam(v: unknown): string {
  return JSON.stringify(v === undefined ? null : v);
}

/** A filter value as it goes into a plain (system column) parameter. */
function plainParam(v: unknown): SqlParam {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  if (v === null || v === undefined) return null;
  return String(v);
}

export function buildWhere(type: string, filters: Filter[]): Where {
  const p = new Params();
  const clauses: string[] = [`type = ${p.add(type)}`];

  for (const f of filters) {
    const sys = SYSTEM_COLUMNS[f.field];
    // For data fields: typed jsonb comparison; for system columns: plain text.
    // The double cast matters: Bun's driver picks the parameter's wire type
    // from the immediate cast context, so `::jsonb` alone makes it re-encode
    // the already-serialized JSON (a number param would not even bind).
    // `::text::jsonb` pins the parameter to text and parses server-side.
    const expr = sys ?? jsonExpr(f.field);
    const param = (v: unknown) =>
      sys ? p.add(plainParam(v)) : `${p.add(jsonbParam(v))}::text::jsonb`;

    switch (f.op) {
      case "eq":
        clauses.push(`${expr} = ${param(f.value)}`);
        break;
      case "ne":
        clauses.push(`(${expr} IS NULL OR ${expr} <> ${param(f.value)})`);
        break;
      case "lt":
      case "lte":
      case "gt":
      case "gte": {
        const op = { lt: "<", lte: "<=", gt: ">", gte: ">=" }[f.op];
        clauses.push(`${expr} ${op} ${param(f.value)}`);
        break;
      }
      case "in":
      case "nin": {
        const values = Array.isArray(f.value) ? f.value : [];
        if (values.length === 0) {
          clauses.push(f.op === "in" ? "FALSE" : "TRUE");
          break;
        }
        const marks = values.map((v) => param(v)).join(", ");
        if (f.op === "in") {
          clauses.push(`${expr} IN (${marks})`);
        } else {
          clauses.push(`(${expr} IS NULL OR ${expr} NOT IN (${marks}))`);
        }
        break;
      }
      case "contains": {
        // ILIKE: SQLite's LIKE is case-insensitive for ASCII, so the
        // case-sensitive Postgres LIKE would diverge from the conformance
        // suite (and from every other connector's behaviour).
        const target = sys ?? textExpr(f.field);
        clauses.push(`${target} ILIKE ${p.add(`%${escapeLike(String(f.value ?? ""))}%`)} ESCAPE '\\'`);
        break;
      }
      case "exists": {
        // ->> maps both a missing key and a JSON null to SQL NULL, which is
        // exactly what SQLite's json_extract does.
        const target = sys ?? textExpr(f.field);
        clauses.push(f.value === false ? `${target} IS NULL` : `${target} IS NOT NULL`);
        break;
      }
    }
  }
  return { sql: clauses.join(" AND "), params: p.values };
}

export function buildOrderBy(sort: Sort[]): string {
  const parts = sort.map((s) => {
    const expr = SYSTEM_COLUMNS[s.field] ?? jsonExpr(s.field);
    // SQLite treats NULL as smaller than everything; make Postgres agree.
    return s.dir === "desc" ? `${expr} DESC NULLS LAST` : `${expr} ASC NULLS FIRST`;
  });
  parts.push("id ASC"); // stable tiebreaker for deterministic pagination
  return parts.join(", ");
}

export interface EntryRow {
  id: string;
  type: string;
  slug: string;
  status: string;
  /** Bun's driver parses jsonb columns; a text fallback stays tolerated. */
  data: Record<string, unknown> | string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
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
    data JSONB NOT NULL,
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
  return `CREATE INDEX IF NOT EXISTS "${assertSafeName(idx)}" ON entries (type, (${jsonExpr(field)}))`;
}

export function dropIndexSql(idx: string): string {
  return `DROP INDEX IF EXISTS "${assertSafeName(idx)}"`;
}
