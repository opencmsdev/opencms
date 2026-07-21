import type { DataConnector } from "../interfaces/data.ts";
import type {
  ContentTypeDef,
  Entry,
  EntryQuery,
  Filter,
  QueryResult,
  Sort,
} from "../types.ts";
import { SYSTEM_FIELDS, type SystemField } from "../types.ts";

const SYSTEM = new Set<string>(SYSTEM_FIELDS);

function fieldValue(entry: Entry, field: string): unknown {
  if (SYSTEM.has(field)) return entry[field as SystemField];
  return entry.data[field];
}

/** Nulls sort first ascending, mirroring SQLite's NULL ordering. */
function compare(a: unknown, b: unknown): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return -1;
  if (bNull) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function matches(entry: Entry, f: Filter): boolean {
  const v = fieldValue(entry, f.field);
  switch (f.op) {
    case "eq":
      return compare(v, f.value) === 0 && v !== null && v !== undefined;
    case "ne":
      return !(compare(v, f.value) === 0 && v !== null && v !== undefined);
    case "lt":
      return v != null && compare(v, f.value) < 0;
    case "lte":
      return v != null && compare(v, f.value) <= 0;
    case "gt":
      return v != null && compare(v, f.value) > 0;
    case "gte":
      return v != null && compare(v, f.value) >= 0;
    case "in":
      return Array.isArray(f.value) && v != null && f.value.some((x) => compare(v, x) === 0);
    case "nin":
      return Array.isArray(f.value) && (v == null || !f.value.some((x) => compare(v, x) === 0));
    case "contains":
      return (
        typeof v === "string" &&
        typeof f.value === "string" &&
        v.toLowerCase().includes(f.value.toLowerCase())
      );
    case "exists":
      return f.value === false ? v == null : v != null;
  }
}

function sortEntries(items: Entry[], sort: Sort[]): Entry[] {
  return [...items].sort((a, b) => {
    for (const s of sort) {
      const c = compare(fieldValue(a, s.field), fieldValue(b, s.field));
      if (c !== 0) return s.dir === "desc" ? -c : c;
    }
    // Stable tiebreaker so pagination is deterministic.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * Reference DataConnector. Semantics defined here are the contract that
 * every real connector must reproduce (enforced by @opencms/test-kit).
 */
export class MemoryDataConnector implements DataConnector {
  private types = new Map<string, ContentTypeDef>();
  private entries = new Map<string, Map<string, Entry>>();

  async init(): Promise<void> {}

  async listTypes(): Promise<ContentTypeDef[]> {
    return [...this.types.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async getType(name: string): Promise<ContentTypeDef | null> {
    return this.types.get(name) ?? null;
  }

  async saveType(def: ContentTypeDef): Promise<void> {
    this.types.set(def.name, structuredClone(def));
    if (!this.entries.has(def.name)) this.entries.set(def.name, new Map());
  }

  async deleteType(name: string): Promise<void> {
    this.types.delete(name);
    this.entries.delete(name);
  }

  async ensureIndexes(_def: ContentTypeDef): Promise<void> {}

  private bucket(type: string): Map<string, Entry> {
    let b = this.entries.get(type);
    if (!b) {
      b = new Map();
      this.entries.set(type, b);
    }
    return b;
  }

  async insertEntry(entry: Entry): Promise<void> {
    this.bucket(entry.type).set(entry.id, structuredClone(entry));
  }

  async updateEntry(entry: Entry): Promise<void> {
    this.bucket(entry.type).set(entry.id, structuredClone(entry));
  }

  async getEntryById(type: string, id: string): Promise<Entry | null> {
    const e = this.bucket(type).get(id);
    return e ? structuredClone(e) : null;
  }

  async getEntryBySlug(type: string, slug: string): Promise<Entry | null> {
    for (const e of this.bucket(type).values()) {
      if (e.slug === slug) return structuredClone(e);
    }
    return null;
  }

  async deleteEntry(type: string, id: string): Promise<void> {
    this.bucket(type).delete(id);
  }

  async queryEntries(type: string, query: EntryQuery): Promise<QueryResult<Entry>> {
    let items = [...this.bucket(type).values()];
    for (const f of query.filter ?? []) items = items.filter((e) => matches(e, f));
    const total = items.length;
    const sort: Sort[] =
      query.sort && query.sort.length > 0
        ? query.sort
        : [{ field: "createdAt", dir: "desc" }];
    items = sortEntries(items, sort);
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 50;
    items = items.slice(offset, offset + limit);
    return { items: items.map((e) => structuredClone(e)), total, limit, offset };
  }

  async countEntries(type: string): Promise<number> {
    return this.bucket(type).size;
  }

  async close(): Promise<void> {
    this.types.clear();
    this.entries.clear();
  }
}
