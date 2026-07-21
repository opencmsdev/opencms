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
 * DataConnector for Cloudflare D1.
 *
 * D1 is SQLite, so all SQL comes verbatim from @opencms/sqlite-dialect: the
 * same statements the self-hosted SQLite connector runs. Only the transport
 * differs (async prepare/bind/all instead of bun:sqlite calls).
 *
 * Structural D1 types are declared locally so this package has zero
 * dependency on @cloudflare/workers-types and typechecks in any runtime.
 */

export interface D1ResultLike<T> {
  results: T[];
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}

export class D1DataConnector implements DataConnector {
  constructor(private readonly db: D1DatabaseLike) {}

  private stmt(sql: string, params: SqlParam[] = []): D1PreparedStatementLike {
    const prepared = this.db.prepare(sql);
    return params.length > 0 ? prepared.bind(...params) : prepared;
  }

  async init(): Promise<void> {
    for (const sql of INIT_STATEMENTS) await this.stmt(sql).run();
  }

  // Content types -------------------------------------------------------------

  async listTypes(): Promise<ContentTypeDef[]> {
    const { results } = await this.stmt(
      "SELECT definition FROM content_types ORDER BY name"
    ).all<{ definition: string }>();
    return results.map((r) => JSON.parse(r.definition) as ContentTypeDef);
  }

  async getType(name: string): Promise<ContentTypeDef | null> {
    const row = await this.stmt("SELECT definition FROM content_types WHERE name = ?", [
      name,
    ]).first<{ definition: string }>();
    return row ? (JSON.parse(row.definition) as ContentTypeDef) : null;
  }

  async saveType(def: ContentTypeDef): Promise<void> {
    await this.stmt(
      `INSERT INTO content_types (name, definition) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET definition = excluded.definition`,
      [def.name, JSON.stringify(def)]
    ).run();
  }

  async deleteType(name: string): Promise<void> {
    for (const idx of await this.listFieldIndexes(name)) {
      await this.stmt(dropIndexSql(idx)).run();
    }
    await this.stmt("DELETE FROM entries WHERE type = ?", [name]).run();
    await this.stmt("DELETE FROM content_types WHERE name = ?", [name]).run();
  }

  private async listFieldIndexes(type: string): Promise<string[]> {
    const { results } = await this.stmt(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE ?",
      ["idx_e_%"]
    ).all<{ name: string }>();
    // LIKE treats _ as a wildcard; filter precisely in JS instead.
    return results.map((r) => r.name).filter((n) => n.startsWith(`idx_e_${type}_`));
  }

  async ensureIndexes(def: ContentTypeDef): Promise<void> {
    const wanted = new Map<string, string>();
    for (const f of def.fields) {
      if (f.indexed) wanted.set(indexName(def.name, f.name), f.name);
    }
    for (const existing of await this.listFieldIndexes(def.name)) {
      if (!wanted.has(existing)) await this.stmt(dropIndexSql(existing)).run();
    }
    for (const [idx, field] of wanted) {
      await this.stmt(createIndexSql(idx, field)).run();
    }
  }

  // Entries ---------------------------------------------------------------------

  async insertEntry(entry: Entry): Promise<void> {
    await this.stmt(
      `INSERT INTO entries (id, type, slug, status, data, created_at, updated_at, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.type,
        entry.slug,
        entry.status,
        JSON.stringify(entry.data),
        entry.createdAt,
        entry.updatedAt,
        entry.publishedAt,
      ]
    ).run();
  }

  async updateEntry(entry: Entry): Promise<void> {
    await this.stmt(
      `UPDATE entries SET slug = ?, status = ?, data = ?, created_at = ?, updated_at = ?, published_at = ?
       WHERE type = ? AND id = ?`,
      [
        entry.slug,
        entry.status,
        JSON.stringify(entry.data),
        entry.createdAt,
        entry.updatedAt,
        entry.publishedAt,
        entry.type,
        entry.id,
      ]
    ).run();
  }

  async getEntryById(type: string, id: string): Promise<Entry | null> {
    const row = await this.stmt("SELECT * FROM entries WHERE type = ? AND id = ?", [
      type,
      id,
    ]).first<EntryRow>();
    return row ? rowToEntry(row) : null;
  }

  async getEntryBySlug(type: string, slug: string): Promise<Entry | null> {
    const row = await this.stmt("SELECT * FROM entries WHERE type = ? AND slug = ?", [
      type,
      slug,
    ]).first<EntryRow>();
    return row ? rowToEntry(row) : null;
  }

  async deleteEntry(type: string, id: string): Promise<void> {
    await this.stmt("DELETE FROM entries WHERE type = ? AND id = ?", [type, id]).run();
  }

  async queryEntries(type: string, query: EntryQuery): Promise<QueryResult<Entry>> {
    const where = buildWhere(type, query.filter ?? []);
    const sort: Sort[] =
      query.sort && query.sort.length > 0
        ? query.sort
        : [{ field: "createdAt", dir: "desc" }];
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const { results } = await this.stmt(
      `SELECT * FROM entries WHERE ${where.sql} ORDER BY ${buildOrderBy(sort)} LIMIT ? OFFSET ?`,
      [...where.params, limit, offset]
    ).all<EntryRow>();

    const totalRow = await this.stmt(
      `SELECT COUNT(*) AS n FROM entries WHERE ${where.sql}`,
      where.params
    ).first<{ n: number }>();

    return { items: results.map(rowToEntry), total: totalRow?.n ?? 0, limit, offset };
  }

  async countEntries(type: string): Promise<number> {
    const row = await this.stmt("SELECT COUNT(*) AS n FROM entries WHERE type = ?", [
      type,
    ]).first<{ n: number }>();
    return row?.n ?? 0;
  }

  async close(): Promise<void> {
    // D1 connections are managed by the platform; nothing to release.
  }
}
