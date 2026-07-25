import { beforeEach, describe, expect, test } from "bun:test";
import { MemoryDataConnector } from "@opencms/core";
import type { ContentTypeDef, Entry, FilterOp } from "@opencms/core";

/**
 * MemoryDataConnector is the reference implementation: whatever it does here is
 * the contract @opencms/test-kit holds every other connector to. These tests
 * drive it directly, bypassing the services, so filter/sort/pagination
 * semantics are pinned independently of the validation layer above them.
 */

const T = (day: number) => `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;

function entry(over: Partial<Entry> & { id: string }): Entry {
  return {
    type: "article",
    slug: over.id,
    status: "draft",
    data: {},
    createdAt: T(1),
    updatedAt: T(1),
    publishedAt: null,
    ...over,
  };
}

let data: MemoryDataConnector;

beforeEach(async () => {
  data = new MemoryDataConnector();
  await data.init();
});

describe("type storage", () => {
  const def: ContentTypeDef = {
    name: "article",
    label: "Article",
    fields: [{ name: "title", kind: "text" }],
    createdAt: T(1),
    updatedAt: T(1),
  };

  test("getType returns null for an unknown name", async () => {
    expect(await data.getType("ghost")).toBeNull();
  });

  test("listTypes sorts by name", async () => {
    await data.saveType({ ...def, name: "zebra" });
    await data.saveType({ ...def, name: "article" });
    expect((await data.listTypes()).map((t) => t.name)).toEqual(["article", "zebra"]);
  });

  test("saveType clones, so later mutation of the caller's object is not visible", async () => {
    const mutable: ContentTypeDef = structuredClone(def);
    await data.saveType(mutable);
    mutable.label = "Mutated";
    mutable.fields.push({ name: "sneaky", kind: "text" });
    const stored = await data.getType("article");
    expect(stored?.label).toBe("Article");
    expect(stored?.fields).toHaveLength(1);
  });

  test("saving over an existing type keeps its entries", async () => {
    await data.saveType(def);
    await data.insertEntry(entry({ id: "a" }));
    await data.saveType({ ...def, label: "Articles" });
    expect(await data.countEntries("article")).toBe(1);
  });

  test("deleteType drops the definition and its entries", async () => {
    await data.saveType(def);
    await data.insertEntry(entry({ id: "a" }));
    await data.deleteType("article");
    expect(await data.getType("article")).toBeNull();
    expect(await data.countEntries("article")).toBe(0);
  });

  test("countEntries is zero for a type that was never seen", async () => {
    expect(await data.countEntries("never-heard-of-it")).toBe(0);
  });

  test("close clears everything", async () => {
    await data.saveType(def);
    await data.insertEntry(entry({ id: "a" }));
    await data.close();
    expect(await data.listTypes()).toEqual([]);
    expect(await data.countEntries("article")).toBe(0);
  });
});

describe("entry storage", () => {
  test("entries are cloned on write and on read", async () => {
    const source = entry({ id: "a", data: { tags: ["x"] } });
    await data.insertEntry(source);
    (source.data.tags as string[]).push("mutated");

    const first = await data.getEntryById("article", "a");
    expect(first?.data.tags).toEqual(["x"]);

    (first?.data.tags as string[]).push("also mutated");
    const second = await data.getEntryById("article", "a");
    expect(second?.data.tags).toEqual(["x"]);
  });

  test("getEntryById and getEntryBySlug return null when absent", async () => {
    expect(await data.getEntryById("article", "nope")).toBeNull();
    expect(await data.getEntryBySlug("article", "nope")).toBeNull();
  });

  test("getEntryBySlug finds by slug, scoped to the type", async () => {
    await data.insertEntry(entry({ id: "a", slug: "shared" }));
    await data.insertEntry(entry({ id: "b", type: "page", slug: "shared" }));
    expect((await data.getEntryBySlug("article", "shared"))?.id).toBe("a");
    expect((await data.getEntryBySlug("page", "shared"))?.id).toBe("b");
  });

  test("deleting a missing entry is a silent no-op", async () => {
    await data.deleteEntry("article", "nope");
    expect(await data.countEntries("article")).toBe(0);
  });

  test("updateEntry replaces the stored row", async () => {
    await data.insertEntry(entry({ id: "a", data: { title: "Old" } }));
    await data.updateEntry(entry({ id: "a", data: { title: "New" } }));
    expect((await data.getEntryById("article", "a"))?.data.title).toBe("New");
    expect(await data.countEntries("article")).toBe(1);
  });
});

describe("query: filter operators", () => {
  beforeEach(async () => {
    await data.insertEntry(entry({ id: "a", data: { views: 10, tag: "Alpha" } }));
    await data.insertEntry(entry({ id: "b", data: { views: 20, tag: "beta" } }));
    await data.insertEntry(entry({ id: "c", data: { views: 30, tag: "gamma" } }));
    await data.insertEntry(entry({ id: "d", status: "published", data: {} })); // views absent
  });

  async function ids(op: FilterOp, value: unknown, field = "views"): Promise<string[]> {
    const { items } = await data.queryEntries("article", {
      filter: [{ field, op, value }],
      sort: [{ field: "id", dir: "asc" }],
    });
    return items.map((e) => e.id);
  }

  test("eq matches exactly and never matches an absent value", async () => {
    expect(await ids("eq", 20)).toEqual(["b"]);
    expect(await ids("eq", null)).toEqual([]);
  });

  test("ne is the strict negation, so it does match absent values", async () => {
    // Worth pinning: `ne` returning the row with no value at all is deliberate,
    // and is what SQL's NOT (col = ?) does not do.
    expect(await ids("ne", 20)).toEqual(["a", "c", "d"]);
  });

  test("ordering operators skip absent values", async () => {
    expect(await ids("gt", 10)).toEqual(["b", "c"]);
    expect(await ids("gte", 20)).toEqual(["b", "c"]);
    expect(await ids("lt", 30)).toEqual(["a", "b"]);
    expect(await ids("lte", 20)).toEqual(["a", "b"]);
  });

  test("in and nin need an array", async () => {
    expect(await ids("in", [10, 30])).toEqual(["a", "c"]);
    expect(await ids("nin", [10, 30])).toEqual(["b", "d"]);
    expect(await ids("in", 10)).toEqual([]);
    expect(await ids("nin", 10)).toEqual([]);
  });

  test("contains is a case-insensitive substring match on strings", async () => {
    expect(await ids("contains", "alph", "tag")).toEqual(["a"]);
    expect(await ids("contains", "ALPH", "tag")).toEqual(["a"]);
    expect(await ids("contains", "a", "tag")).toEqual(["a", "b", "c"]);
    expect(await ids("contains", 1, "views")).toEqual([]);
  });

  test("exists splits present from absent", async () => {
    expect(await ids("exists", true)).toEqual(["a", "b", "c"]);
    expect(await ids("exists", false)).toEqual(["d"]);
  });

  test("multiple filters are ANDed", async () => {
    const { items } = await data.queryEntries("article", {
      filter: [
        { field: "views", op: "gte", value: 20 },
        { field: "status", op: "eq", value: "draft" },
      ],
    });
    // Same createdAt across the fixtures, so the id tiebreaker decides order.
    expect(items.map((e) => e.id)).toEqual(["b", "c"]);
  });

  test("system fields are filterable", async () => {
    const { items } = await data.queryEntries("article", {
      filter: [{ field: "status", op: "eq", value: "published" }],
    });
    expect(items.map((e) => e.id)).toEqual(["d"]);
  });
});

describe("query: sorting", () => {
  test("defaults to createdAt descending", async () => {
    await data.insertEntry(entry({ id: "old", createdAt: T(1) }));
    await data.insertEntry(entry({ id: "new", createdAt: T(3) }));
    await data.insertEntry(entry({ id: "mid", createdAt: T(2) }));
    const { items } = await data.queryEntries("article", {});
    expect(items.map((e) => e.id)).toEqual(["new", "mid", "old"]);
  });

  test("an empty sort array also falls back to the default", async () => {
    await data.insertEntry(entry({ id: "old", createdAt: T(1) }));
    await data.insertEntry(entry({ id: "new", createdAt: T(3) }));
    const { items } = await data.queryEntries("article", { sort: [] });
    expect(items.map((e) => e.id)).toEqual(["new", "old"]);
  });

  test("numbers sort numerically, not lexicographically", async () => {
    await data.insertEntry(entry({ id: "a", data: { n: 9 } }));
    await data.insertEntry(entry({ id: "b", data: { n: 10 } }));
    const { items } = await data.queryEntries("article", {
      sort: [{ field: "n", dir: "asc" }],
    });
    expect(items.map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("nulls sort first ascending and last descending", async () => {
    await data.insertEntry(entry({ id: "has", data: { n: 1 } }));
    await data.insertEntry(entry({ id: "none", data: {} }));
    const asc = await data.queryEntries("article", { sort: [{ field: "n", dir: "asc" }] });
    expect(asc.items.map((e) => e.id)).toEqual(["none", "has"]);
    const desc = await data.queryEntries("article", { sort: [{ field: "n", dir: "desc" }] });
    expect(desc.items.map((e) => e.id)).toEqual(["has", "none"]);
  });

  test("booleans sort false before true", async () => {
    await data.insertEntry(entry({ id: "t", data: { flag: true } }));
    await data.insertEntry(entry({ id: "f", data: { flag: false } }));
    const { items } = await data.queryEntries("article", {
      sort: [{ field: "flag", dir: "asc" }],
    });
    expect(items.map((e) => e.id)).toEqual(["f", "t"]);
  });

  test("multi-key sort uses the first non-equal key", async () => {
    await data.insertEntry(entry({ id: "a", data: { group: "x", n: 2 } }));
    await data.insertEntry(entry({ id: "b", data: { group: "x", n: 1 } }));
    await data.insertEntry(entry({ id: "c", data: { group: "a", n: 9 } }));
    const { items } = await data.queryEntries("article", {
      sort: [
        { field: "group", dir: "asc" },
        { field: "n", dir: "asc" },
      ],
    });
    expect(items.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  test("ties break on id, so pagination is deterministic", async () => {
    await data.insertEntry(entry({ id: "b", createdAt: T(1) }));
    await data.insertEntry(entry({ id: "a", createdAt: T(1) }));
    await data.insertEntry(entry({ id: "c", createdAt: T(1) }));
    const { items } = await data.queryEntries("article", {});
    expect(items.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });
});

describe("query: pagination", () => {
  beforeEach(async () => {
    for (let i = 0; i < 10; i++) {
      await data.insertEntry(entry({ id: `e${i}`, createdAt: T(i + 1) }));
    }
  });

  test("total is the filtered count, before slicing", async () => {
    const res = await data.queryEntries("article", { limit: 3, offset: 0 });
    expect(res.items).toHaveLength(3);
    expect(res.total).toBe(10);
    expect(res.limit).toBe(3);
    expect(res.offset).toBe(0);
  });

  test("offset walks the result set without overlap", async () => {
    const first = await data.queryEntries("article", { limit: 4, offset: 0 });
    const second = await data.queryEntries("article", { limit: 4, offset: 4 });
    const overlap = first.items.filter((a) => second.items.some((b) => b.id === a.id));
    expect(overlap).toEqual([]);
  });

  test("an offset past the end yields no items but a real total", async () => {
    const res = await data.queryEntries("article", { limit: 5, offset: 50 });
    expect(res.items).toEqual([]);
    expect(res.total).toBe(10);
  });

  test("connector-level defaults are offset 0 and limit 50", async () => {
    const res = await data.queryEntries("article", {});
    expect(res.offset).toBe(0);
    expect(res.limit).toBe(50);
    expect(res.items).toHaveLength(10);
  });

  test("total reflects the filter, not the whole bucket", async () => {
    const res = await data.queryEntries("article", {
      filter: [{ field: "createdAt", op: "gte", value: T(6) }],
      limit: 2,
    });
    expect(res.total).toBe(5);
    expect(res.items).toHaveLength(2);
  });
});
