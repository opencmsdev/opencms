import { beforeEach, describe, expect, test } from "bun:test";
import {
  ConflictError,
  ContentTypeService,
  EntryService,
  MemoryDataConnector,
  NotFoundError,
  ValidationError,
} from "@opencms/core";
import type { Clock, ContentTypeInput, IdGenerator } from "@opencms/core";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-06-15T12:00:00.000Z";
const T2 = "2026-09-30T08:00:00.000Z";

let data: MemoryDataConnector;
let types: ContentTypeService;
let entries: EntryService;
let now: Date;
let ids: number;

const clock: Clock = () => now;
const newId: IdGenerator = () => `id-${++ids}`;

const article: ContentTypeInput = {
  name: "article",
  label: "Article",
  fields: [
    { name: "title", kind: "text", required: true },
    { name: "subtitle", kind: "text" },
    { name: "views", kind: "number", indexed: true },
    { name: "email", kind: "text", unique: true },
  ],
};

/** A type with no text field at all, to exercise the slug fallback. */
const metric: ContentTypeInput = {
  name: "metric",
  label: "Metric",
  fields: [{ name: "value", kind: "number" }],
};

beforeEach(async () => {
  now = new Date(T0);
  ids = 0;
  data = new MemoryDataConnector();
  await data.init();
  types = new ContentTypeService(data, clock);
  entries = new EntryService(data, clock, newId);
  await types.create(article);
  await types.create(metric);
});

describe("EntryService.create", () => {
  test("stamps id, timestamps and a draft status", async () => {
    const entry = await entries.create("article", { data: { title: "Hello" } });
    expect(entry.id).toBe("id-1");
    expect(entry.type).toBe("article");
    expect(entry.status).toBe("draft");
    expect(entry.publishedAt).toBeNull();
    expect(entry.createdAt).toBe(T0);
    expect(entry.updatedAt).toBe(T0);
  });

  test("creating as published sets publishedAt to now", async () => {
    const entry = await entries.create("article", {
      status: "published",
      data: { title: "Hello" },
    });
    expect(entry.status).toBe("published");
    expect(entry.publishedAt).toBe(T0);
  });

  test("materialises defaults into the stored data", async () => {
    await types.create({
      name: "post",
      label: "Post",
      fields: [
        { name: "title", kind: "text", required: true },
        { name: "featured", kind: "boolean", default: false },
      ],
    });
    const entry = await entries.create("post", { data: { title: "Hi" } });
    expect(entry.data).toEqual({ title: "Hi", featured: false });
  });

  test("treats missing data as an empty object", async () => {
    // The type has no required fields, so {} is valid.
    const entry = await entries.create("metric", {} as { data: Record<string, unknown> });
    expect(entry.data).toEqual({});
  });

  test("rejects invalid data on a real type", async () => {
    await expect(entries.create("article", { data: {} })).rejects.toThrow(ValidationError);
    await expect(
      entries.create("article", { data: { title: "Hi", views: "many" } })
    ).rejects.toThrow(ValidationError);
  });

  test("rejects an unknown type", async () => {
    await expect(entries.create("ghost", { data: {} })).rejects.toThrow(
      /content type "ghost" not found/
    );
  });
});

describe("EntryService.create: slug derivation", () => {
  test("derives from the first text field, not a later one", async () => {
    const entry = await entries.create("article", {
      data: { title: "The Real Title", subtitle: "The Subtitle" },
    });
    expect(entry.slug).toBe("the-real-title");
  });

  test("falls back to an id-based slug when the type has no text field", async () => {
    const entry = await entries.create("metric", { data: { value: 1 } });
    // deriveSlug pulls an id for the slug before create pulls one for the entry.
    expect(entry.slug).toBe("entry-id-1");
    expect(entry.id).toBe("id-2");
  });

  // A non-string value cannot reach deriveSlug: validateEntryData rejects it
  // first, so the `typeof source === "string"` guard is defence in depth only.
  test.each([[undefined], [null], [""], ["   "]])(
    "falls back when the text value is %p",
    async (value) => {
      await types.create({
        name: "loose",
        label: "Loose",
        fields: [{ name: "title", kind: "text" }],
      });
      const entry = await entries.create("loose", {
        data: value === undefined ? {} : { title: value },
      });
      expect(entry.slug.startsWith("entry-")).toBe(true);
    }
  );

  test("uses an explicit slug verbatim", async () => {
    const entry = await entries.create("article", {
      slug: "my-own-slug",
      data: { title: "Ignored For Slug" },
    });
    expect(entry.slug).toBe("my-own-slug");
  });

  test("rejects an explicit invalid slug with a slug-scoped issue", async () => {
    try {
      await entries.create("article", { slug: "Not A Slug", data: { title: "Hi" } });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      const issues = (err as ValidationError).issues;
      expect(issues).toEqual([
        { path: "slug", message: "slugs are lowercase words separated by single hyphens" },
      ]);
    }
  });

  test("a very long title still derives a usable slug", async () => {
    const entry = await entries.create("article", {
      data: { title: `${"a".repeat(79)} b` },
    });
    expect(entry.slug.endsWith("-")).toBe(false);
  });

  test("rejects a colliding slug", async () => {
    await entries.create("article", { data: { title: "Hello" } });
    await expect(entries.create("article", { data: { title: "Hello" } })).rejects.toThrow(
      /slug "hello" already exists in "article"/
    );
  });

  test("the same slug in a different type is fine", async () => {
    await entries.create("article", { data: { title: "Shared" } });
    await types.create({
      name: "page",
      label: "Page",
      fields: [{ name: "title", kind: "text" }],
    });
    const page = await entries.create("page", { data: { title: "Shared" } });
    expect(page.slug).toBe("shared");
  });
});

describe("EntryService: unique fields", () => {
  test("rejects a duplicate value", async () => {
    await entries.create("article", { data: { title: "A", email: "a@b.c" } });
    await expect(
      entries.create("article", { data: { title: "B", email: "a@b.c" } })
    ).rejects.toThrow(/value for unique field "email" already exists in "article"/);
  });

  test("several entries may omit the unique field", async () => {
    await entries.create("article", { data: { title: "A" } });
    await entries.create("article", { data: { title: "B" } });
    await entries.create("article", { data: { title: "C", email: null } });
    const { total } = await entries.query("article");
    expect(total).toBe(3);
  });

  test("updating an entry without changing its unique value is not a conflict", async () => {
    const entry = await entries.create("article", { data: { title: "A", email: "a@b.c" } });
    const updated = await entries.update("article", entry.id, { data: { title: "A2" } });
    expect(updated.data.title).toBe("A2");
    expect(updated.data.email).toBe("a@b.c");
  });

  test("updating onto another entry's unique value is a conflict", async () => {
    await entries.create("article", { data: { title: "A", email: "a@b.c" } });
    const second = await entries.create("article", { data: { title: "B", email: "b@b.c" } });
    await expect(
      entries.update("article", second.id, { data: { email: "a@b.c" } })
    ).rejects.toThrow(ConflictError);
  });

  test("non-unique fields may repeat freely", async () => {
    await entries.create("article", { data: { title: "A", views: 10 } });
    await entries.create("article", { data: { title: "B", views: 10 } });
    const { total } = await entries.query("article");
    expect(total).toBe(2);
  });
});

describe("EntryService.getById and getBySlug", () => {
  test("getById returns the entry", async () => {
    const created = await entries.create("article", { data: { title: "Hello" } });
    expect((await entries.getById("article", created.id)).id).toBe(created.id);
  });

  test("getById rejects an unknown id and an unknown type", async () => {
    await expect(entries.getById("article", "nope")).rejects.toThrow(
      /entry "nope" not found in "article"/
    );
    await expect(entries.getById("ghost", "nope")).rejects.toThrow(
      /content type "ghost" not found/
    );
  });

  test("getBySlug returns the entry", async () => {
    await entries.create("article", { data: { title: "Hello World" } });
    expect((await entries.getBySlug("article", "hello-world")).data.title).toBe("Hello World");
  });

  test("getBySlug rejects an unknown slug and an unknown type", async () => {
    await expect(entries.getBySlug("article", "nope")).rejects.toThrow(
      /entry with slug "nope" not found in "article"/
    );
    await expect(entries.getBySlug("ghost", "nope")).rejects.toThrow(NotFoundError);
  });
});

describe("EntryService.update", () => {
  test("preserves id and createdAt while advancing updatedAt", async () => {
    const created = await entries.create("article", { data: { title: "A" } });
    now = new Date(T1);
    const updated = await entries.update("article", created.id, { data: { title: "B" } });
    expect(updated.id).toBe(created.id);
    expect(updated.type).toBe("article");
    expect(updated.createdAt).toBe(T0);
    expect(updated.updatedAt).toBe(T1);
  });

  test("an omitted data patch revalidates the current data unchanged", async () => {
    const created = await entries.create("article", { data: { title: "A", views: 3 } });
    const updated = await entries.update("article", created.id, {});
    expect(updated.data).toEqual({ title: "A", views: 3 });
  });

  test("the patch is a shallow merge and cannot delete a key", async () => {
    const created = await entries.create("article", { data: { title: "A", views: 3 } });
    const updated = await entries.update("article", created.id, { data: { views: 4 } });
    expect(updated.data).toEqual({ title: "A", views: 4 });
  });

  test("patching a required field to null is rejected", async () => {
    const created = await entries.create("article", { data: { title: "A" } });
    await expect(
      entries.update("article", created.id, { data: { title: null } })
    ).rejects.toThrow(ValidationError);
  });

  test("patching an optional field to null is allowed", async () => {
    const created = await entries.create("article", { data: { title: "A", views: 3 } });
    const updated = await entries.update("article", created.id, { data: { views: null } });
    expect(updated.data.views).toBeNull();
  });

  test("keeping the slug does not conflict with itself", async () => {
    const created = await entries.create("article", { data: { title: "A" } });
    const updated = await entries.update("article", created.id, { data: { title: "A2" } });
    expect(updated.slug).toBe("a");
  });

  test("moving to a free slug works, and onto a taken one conflicts", async () => {
    const first = await entries.create("article", { data: { title: "First" } });
    await entries.create("article", { data: { title: "Second" } });

    const moved = await entries.update("article", first.id, { slug: "brand-new" });
    expect(moved.slug).toBe("brand-new");

    await expect(entries.update("article", first.id, { slug: "second" })).rejects.toThrow(
      /slug "second" already exists in "article"/
    );
  });

  test("rejects an invalid slug", async () => {
    const created = await entries.create("article", { data: { title: "A" } });
    await expect(entries.update("article", created.id, { slug: "Nope!" })).rejects.toThrow(
      ValidationError
    );
  });

  test("rejects unknown types and ids", async () => {
    await expect(entries.update("ghost", "x", {})).rejects.toThrow(NotFoundError);
    await expect(entries.update("article", "nope", {})).rejects.toThrow(NotFoundError);
  });
});

describe("EntryService: publish lifecycle", () => {
  test("publish stamps publishedAt, and republishing keeps the original", async () => {
    const created = await entries.create("article", { data: { title: "A" } });
    now = new Date(T1);
    const published = await entries.publish("article", created.id);
    expect(published.status).toBe("published");
    expect(published.publishedAt).toBe(T1);

    now = new Date(T2);
    const unpublished = await entries.unpublish("article", created.id);
    expect(unpublished.status).toBe("draft");
    // Unpublishing keeps the first-published timestamp so republishing is stable.
    expect(unpublished.publishedAt).toBe(T1);

    const republished = await entries.publish("article", created.id);
    expect(republished.publishedAt).toBe(T1);
    expect(republished.updatedAt).toBe(T2);
  });

  test("unpublishing an already-draft entry is a no-op status-wise", async () => {
    const created = await entries.create("article", { data: { title: "A" } });
    const out = await entries.unpublish("article", created.id);
    expect(out.status).toBe("draft");
    expect(out.publishedAt).toBeNull();
  });

  test("publish rejects unknown types and ids", async () => {
    await expect(entries.publish("article", "nope")).rejects.toThrow(NotFoundError);
    await expect(entries.publish("ghost", "nope")).rejects.toThrow(NotFoundError);
  });
});

describe("EntryService.delete", () => {
  test("removes the entry and frees its slug", async () => {
    const created = await entries.create("article", { data: { title: "Hello" } });
    await entries.delete("article", created.id);
    await expect(entries.getById("article", created.id)).rejects.toThrow(NotFoundError);
    const reused = await entries.create("article", { data: { title: "Hello" } });
    expect(reused.slug).toBe("hello");
  });

  test("rejects unknown types and ids", async () => {
    await expect(entries.delete("article", "nope")).rejects.toThrow(NotFoundError);
    await expect(entries.delete("ghost", "nope")).rejects.toThrow(NotFoundError);
  });
});

describe("EntryService.query", () => {
  beforeEach(async () => {
    for (let i = 0; i < 5; i++) {
      now = new Date(Date.UTC(2026, 0, i + 1));
      await entries.create("article", { data: { title: `Post ${i}`, views: i * 10 } });
    }
    now = new Date(T0);
  });

  test("rejects an unknown filter field", async () => {
    await expect(
      entries.query("article", { filter: [{ field: "nope", op: "eq", value: 1 }] })
    ).rejects.toThrow(/unknown filter field "nope"/);
  });

  test("rejects an unknown sort field", async () => {
    await expect(
      entries.query("article", { sort: [{ field: "nope", dir: "asc" }] })
    ).rejects.toThrow(/unknown sort field "nope"/);
  });

  test("accepts system fields and declared fields for filter and sort", async () => {
    const byStatus = await entries.query("article", {
      filter: [{ field: "status", op: "eq", value: "draft" }],
      sort: [{ field: "createdAt", dir: "asc" }],
    });
    expect(byStatus.total).toBe(5);

    const byViews = await entries.query("article", {
      filter: [{ field: "views", op: "gte", value: 30 }],
      sort: [{ field: "views", dir: "desc" }],
    });
    expect(byViews.items.map((e) => e.data.views)).toEqual([40, 30]);
  });

  test("clamps the limit into 1..200", async () => {
    expect((await entries.query("article", { limit: 9999 })).items.length).toBe(5);
    expect((await entries.query("article", { limit: 0 })).items.length).toBe(1);
    expect((await entries.query("article", { limit: -5 })).items.length).toBe(1);
  });

  test("clamps a negative offset to zero", async () => {
    const res = await entries.query("article", { offset: -10, limit: 2 });
    expect(res.items).toHaveLength(2);
    expect(res.total).toBe(5);
  });

  test("total counts every match, not just the page", async () => {
    const res = await entries.query("article", { limit: 2, offset: 2 });
    expect(res.items).toHaveLength(2);
    expect(res.total).toBe(5);
  });

  test("an offset past the end returns no items but a real total", async () => {
    const res = await entries.query("article", { limit: 2, offset: 99 });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(5);
  });

  test("defaults to newest first", async () => {
    const res = await entries.query("article");
    expect(res.items.map((e) => e.data.title)).toEqual([
      "Post 4",
      "Post 3",
      "Post 2",
      "Post 1",
      "Post 0",
    ]);
  });

  test("rejects an unknown type", async () => {
    await expect(entries.query("ghost")).rejects.toThrow(NotFoundError);
  });
});
