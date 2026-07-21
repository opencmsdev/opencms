import type { DataConnector } from "../interfaces/data.ts";
import type {
  ContentTypeDef,
  Entry,
  EntryCreateInput,
  EntryQuery,
  EntryUpdateInput,
  QueryResult,
} from "../types.ts";
import { SYSTEM_FIELDS } from "../types.ts";
import { validateEntryData } from "../fields.ts";
import { isValidSlug, slugify } from "../slug.ts";
import { ConflictError, NotFoundError, ValidationError } from "../errors.ts";
import type { Clock } from "./content-types.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface IdGenerator {
  (): string;
}

export class EntryService {
  constructor(
    private readonly data: DataConnector,
    private readonly clock: Clock = () => new Date(),
    private readonly newId: IdGenerator = () => crypto.randomUUID()
  ) {}

  private async getTypeOrThrow(type: string): Promise<ContentTypeDef> {
    const def = await this.data.getType(type);
    if (!def) throw new NotFoundError(`content type "${type}" not found`);
    return def;
  }

  /** Derive a slug from the first text field, falling back to a short id. */
  private deriveSlug(def: ContentTypeDef, data: Record<string, unknown>): string {
    const firstText = def.fields.find((f) => f.kind === "text");
    const source = firstText ? data[firstText.name] : undefined;
    if (typeof source === "string" && source.trim().length > 0) return slugify(source);
    return `entry-${this.newId().slice(0, 8)}`;
  }

  private async assertSlugFree(type: string, slug: string, excludeId?: string): Promise<void> {
    const existing = await this.data.getEntryBySlug(type, slug);
    if (existing && existing.id !== excludeId) {
      throw new ConflictError(`slug "${slug}" already exists in "${type}"`);
    }
  }

  private async assertUniqueFields(
    def: ContentTypeDef,
    data: Record<string, unknown>,
    excludeId?: string
  ): Promise<void> {
    for (const f of def.fields) {
      if (!f.unique) continue;
      const value = data[f.name];
      if (value === undefined || value === null) continue;
      const { items } = await this.data.queryEntries(def.name, {
        filter: [{ field: f.name, op: "eq", value }],
        limit: 2,
      });
      const clash = items.find((e) => e.id !== excludeId);
      if (clash) {
        throw new ConflictError(`value for unique field "${f.name}" already exists in "${def.name}"`);
      }
    }
  }

  async create(type: string, input: EntryCreateInput): Promise<Entry> {
    const def = await this.getTypeOrThrow(type);
    const data = validateEntryData(def, input.data ?? {});
    const slug = input.slug ?? this.deriveSlug(def, data);
    if (!isValidSlug(slug)) {
      throw new ValidationError(`invalid slug "${slug}"`, [
        { path: "slug", message: "slugs are lowercase words separated by single hyphens" },
      ]);
    }
    await this.assertSlugFree(type, slug);
    await this.assertUniqueFields(def, data);
    const now = this.clock().toISOString();
    const status = input.status ?? "draft";
    const entry: Entry = {
      id: this.newId(),
      type,
      slug,
      status,
      data,
      createdAt: now,
      updatedAt: now,
      publishedAt: status === "published" ? now : null,
    };
    await this.data.insertEntry(entry);
    return entry;
  }

  async getById(type: string, id: string): Promise<Entry> {
    await this.getTypeOrThrow(type);
    const entry = await this.data.getEntryById(type, id);
    if (!entry) throw new NotFoundError(`entry "${id}" not found in "${type}"`);
    return entry;
  }

  async getBySlug(type: string, slug: string): Promise<Entry> {
    await this.getTypeOrThrow(type);
    const entry = await this.data.getEntryBySlug(type, slug);
    if (!entry) throw new NotFoundError(`entry with slug "${slug}" not found in "${type}"`);
    return entry;
  }

  async update(type: string, id: string, input: EntryUpdateInput): Promise<Entry> {
    const def = await this.getTypeOrThrow(type);
    const current = await this.getById(type, id);
    const mergedData = validateEntryData(def, { ...current.data, ...(input.data ?? {}) });

    const slug = input.slug ?? current.slug;
    if (!isValidSlug(slug)) {
      throw new ValidationError(`invalid slug "${slug}"`, [
        { path: "slug", message: "slugs are lowercase words separated by single hyphens" },
      ]);
    }
    if (slug !== current.slug) await this.assertSlugFree(type, slug, id);
    await this.assertUniqueFields(def, mergedData, id);

    const now = this.clock().toISOString();
    const status = input.status ?? current.status;
    const entry: Entry = {
      ...current,
      slug,
      status,
      data: mergedData,
      updatedAt: now,
      publishedAt:
        status === "published"
          ? current.publishedAt ?? now
          : current.publishedAt,
    };
    await this.data.updateEntry(entry);
    return entry;
  }

  async publish(type: string, id: string): Promise<Entry> {
    return this.update(type, id, { status: "published" });
  }

  async unpublish(type: string, id: string): Promise<Entry> {
    const entry = await this.update(type, id, { status: "draft" });
    return entry;
  }

  async delete(type: string, id: string): Promise<void> {
    await this.getById(type, id);
    await this.data.deleteEntry(type, id);
  }

  async query(type: string, query: EntryQuery = {}): Promise<QueryResult<Entry>> {
    const def = await this.getTypeOrThrow(type);
    const known = new Set<string>([...SYSTEM_FIELDS, ...def.fields.map((f) => f.name)]);
    for (const f of query.filter ?? []) {
      if (!known.has(f.field)) {
        throw new ValidationError(`unknown filter field "${f.field}"`, [
          { path: f.field, message: "not a system field or a declared field" },
        ]);
      }
    }
    for (const s of query.sort ?? []) {
      if (!known.has(s.field)) {
        throw new ValidationError(`unknown sort field "${s.field}"`, [
          { path: s.field, message: "not a system field or a declared field" },
        ]);
      }
    }
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const offset = Math.max(query.offset ?? 0, 0);
    return this.data.queryEntries(type, { ...query, limit, offset });
  }
}
