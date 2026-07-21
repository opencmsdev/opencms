/**
 * The connector conformance suite.
 *
 * A DataConnector is valid if and only if this suite passes against it.
 * Run it from any package's tests:
 *
 *   runDataConnectorSuite("sqlite", async () => ({
 *     connector: await makeConnector(),
 *     cleanup: async (c) => c.close(),
 *   }));
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ContentTypeDef, DataConnector, Entry } from "@opencms/core";

export interface ConnectorHarness {
  connector: DataConnector;
  cleanup?: (connector: DataConnector) => Promise<void>;
}

export type HarnessFactory = () => Promise<ConnectorHarness>;

const T = (iso: string) => iso;

const productType: ContentTypeDef = {
  name: "product",
  label: "Product",
  fields: [
    { name: "title", kind: "text", required: true },
    { name: "price", kind: "number", indexed: true },
    { name: "sku", kind: "text", unique: true, indexed: true },
    { name: "inStock", kind: "boolean" },
    { name: "tags", kind: "json" },
  ],
  createdAt: T("2026-01-01T00:00:00.000Z"),
  updatedAt: T("2026-01-01T00:00:00.000Z"),
};

function entry(partial: Partial<Entry> & Pick<Entry, "id" | "slug">): Entry {
  return {
    type: "product",
    status: "draft",
    data: {},
    createdAt: T("2026-01-01T00:00:00.000Z"),
    updatedAt: T("2026-01-01T00:00:00.000Z"),
    publishedAt: null,
    ...partial,
  };
}

const FIXTURES: Entry[] = [
  entry({
    id: "e1",
    slug: "keyboard",
    status: "published",
    publishedAt: T("2026-01-05T00:00:00.000Z"),
    createdAt: T("2026-01-02T00:00:00.000Z"),
    data: { title: "Mechanical Keyboard", price: 120, sku: "KB-1", inStock: true },
  }),
  entry({
    id: "e2",
    slug: "mouse",
    createdAt: T("2026-01-03T00:00:00.000Z"),
    data: { title: "Wireless Mouse", price: 45, sku: "MS-1", inStock: true },
  }),
  entry({
    id: "e3",
    slug: "monitor",
    status: "published",
    publishedAt: T("2026-01-06T00:00:00.000Z"),
    createdAt: T("2026-01-04T00:00:00.000Z"),
    data: { title: "4K Monitor", price: 420, sku: "MN-1", inStock: false },
  }),
  entry({
    id: "e4",
    slug: "deskmat",
    createdAt: T("2026-01-05T00:00:00.000Z"),
    // price intentionally absent to exercise exists/null semantics
    data: { title: "Desk Mat", sku: "DM-1", inStock: true },
  }),
];

export function runDataConnectorSuite(name: string, factory: HarnessFactory): void {
  describe(`DataConnector conformance: ${name}`, () => {
    let harness: ConnectorHarness;
    let c: DataConnector;

    beforeEach(async () => {
      harness = await factory();
      c = harness.connector;
      await c.init();
      await c.init(); // init must be idempotent
      await c.saveType(productType);
      await c.ensureIndexes(productType);
      for (const e of FIXTURES) await c.insertEntry(e);
    });

    afterEach(async () => {
      await harness.cleanup?.(c);
    });

    // Content types ----------------------------------------------------------
    test("types: save, get, list, delete", async () => {
      const got = await c.getType("product");
      expect(got?.label).toBe("Product");
      expect(got?.fields.find((f) => f.name === "price")?.indexed).toBe(true);

      const other: ContentTypeDef = { ...productType, name: "author", label: "Author", fields: [] };
      await c.saveType(other);
      const names = (await c.listTypes()).map((t) => t.name);
      expect(names).toContain("product");
      expect(names).toContain("author");

      await c.deleteType("author");
      expect(await c.getType("author")).toBeNull();
      expect(await c.getType("missing")).toBeNull();
    });

    test("types: saveType replaces the definition", async () => {
      await c.saveType({ ...productType, label: "Products!" });
      expect((await c.getType("product"))?.label).toBe("Products!");
    });

    // Entry CRUD ---------------------------------------------------------------
    test("entries: get by id and slug, delete", async () => {
      const byId = await c.getEntryById("product", "e1");
      expect(byId?.data.title).toBe("Mechanical Keyboard");
      expect(byId?.publishedAt).toBe("2026-01-05T00:00:00.000Z");

      const bySlug = await c.getEntryBySlug("product", "mouse");
      expect(bySlug?.id).toBe("e2");

      expect(await c.getEntryById("product", "nope")).toBeNull();
      expect(await c.getEntryBySlug("product", "nope")).toBeNull();

      await c.deleteEntry("product", "e2");
      expect(await c.getEntryById("product", "e2")).toBeNull();
      expect(await c.countEntries("product")).toBe(3);
    });

    test("entries: update replaces the stored object", async () => {
      const e = (await c.getEntryById("product", "e1"))!;
      await c.updateEntry({
        ...e,
        slug: "keyboard-pro",
        data: { ...e.data, price: 150 },
        updatedAt: T("2026-02-01T00:00:00.000Z"),
      });
      const after = (await c.getEntryById("product", "e1"))!;
      expect(after.slug).toBe("keyboard-pro");
      expect(after.data.price).toBe(150);
      expect(after.updatedAt).toBe("2026-02-01T00:00:00.000Z");
      expect(await c.getEntryBySlug("product", "keyboard")).toBeNull();
    });

    test("entries: JSON payload round-trips complex values", async () => {
      const e = (await c.getEntryById("product", "e4"))!;
      await c.updateEntry({
        ...e,
        data: { ...e.data, tags: ["desk", "accessory", { nested: true, n: 1.5 }] },
      });
      const after = (await c.getEntryById("product", "e4"))!;
      expect(after.data.tags).toEqual(["desk", "accessory", { nested: true, n: 1.5 }]);
      expect(after.data.inStock).toBe(true);
    });

    // Query: filters -----------------------------------------------------------
    test("query: system field filters", async () => {
      const published = await c.queryEntries("product", {
        filter: [{ field: "status", op: "eq", value: "published" }],
      });
      expect(published.items.map((e) => e.id).sort()).toEqual(["e1", "e3"]);
      expect(published.total).toBe(2);

      const after = await c.queryEntries("product", {
        filter: [{ field: "createdAt", op: "gte", value: "2026-01-04T00:00:00.000Z" }],
      });
      expect(after.items.map((e) => e.id).sort()).toEqual(["e3", "e4"]);
    });

    test("query: data field comparisons are numeric for numbers", async () => {
      const cheap = await c.queryEntries("product", {
        filter: [{ field: "price", op: "lt", value: 100 }],
      });
      expect(cheap.items.map((e) => e.id)).toEqual(["e2"]);

      // Would fail with lexical comparison: "45" > "120" as strings.
      const expensive = await c.queryEntries("product", {
        filter: [{ field: "price", op: "gte", value: 120 }],
      });
      expect(expensive.items.map((e) => e.id).sort()).toEqual(["e1", "e3"]);
    });

    test("query: eq/ne/in/nin/contains/exists", async () => {
      const eq = await c.queryEntries("product", {
        filter: [{ field: "sku", op: "eq", value: "KB-1" }],
      });
      expect(eq.items.map((e) => e.id)).toEqual(["e1"]);

      const ne = await c.queryEntries("product", {
        filter: [{ field: "sku", op: "ne", value: "KB-1" }],
      });
      expect(ne.items.map((e) => e.id).sort()).toEqual(["e2", "e3", "e4"]);

      const inn = await c.queryEntries("product", {
        filter: [{ field: "sku", op: "in", value: ["KB-1", "MN-1"] }],
      });
      expect(inn.items.map((e) => e.id).sort()).toEqual(["e1", "e3"]);

      const nin = await c.queryEntries("product", {
        filter: [{ field: "sku", op: "nin", value: ["KB-1", "MN-1"] }],
      });
      expect(nin.items.map((e) => e.id).sort()).toEqual(["e2", "e4"]);

      const contains = await c.queryEntries("product", {
        filter: [{ field: "title", op: "contains", value: "monitor" }],
      });
      expect(contains.items.map((e) => e.id)).toEqual(["e3"]);

      const hasPrice = await c.queryEntries("product", {
        filter: [{ field: "price", op: "exists" }],
      });
      expect(hasPrice.items.map((e) => e.id).sort()).toEqual(["e1", "e2", "e3"]);

      const noPrice = await c.queryEntries("product", {
        filter: [{ field: "price", op: "exists", value: false }],
      });
      expect(noPrice.items.map((e) => e.id)).toEqual(["e4"]);
    });

    test("query: boolean data filters", async () => {
      const inStock = await c.queryEntries("product", {
        filter: [{ field: "inStock", op: "eq", value: true }],
      });
      expect(inStock.items.map((e) => e.id).sort()).toEqual(["e1", "e2", "e4"]);
    });

    test("query: combined filters AND together", async () => {
      const r = await c.queryEntries("product", {
        filter: [
          { field: "inStock", op: "eq", value: true },
          { field: "price", op: "lt", value: 100 },
        ],
      });
      expect(r.items.map((e) => e.id)).toEqual(["e2"]);
    });

    // Query: sort + pagination ---------------------------------------------------
    test("query: sort by data field, both directions", async () => {
      const asc = await c.queryEntries("product", {
        filter: [{ field: "price", op: "exists" }],
        sort: [{ field: "price", dir: "asc" }],
      });
      expect(asc.items.map((e) => e.data.price)).toEqual([45, 120, 420]);

      const desc = await c.queryEntries("product", {
        filter: [{ field: "price", op: "exists" }],
        sort: [{ field: "price", dir: "desc" }],
      });
      expect(desc.items.map((e) => e.data.price)).toEqual([420, 120, 45]);
    });

    test("query: default sort is createdAt desc", async () => {
      const r = await c.queryEntries("product", {});
      expect(r.items.map((e) => e.id)).toEqual(["e4", "e3", "e2", "e1"]);
    });

    test("query: pagination with exact totals", async () => {
      const p1 = await c.queryEntries("product", {
        sort: [{ field: "createdAt", dir: "asc" }],
        limit: 2,
        offset: 0,
      });
      const p2 = await c.queryEntries("product", {
        sort: [{ field: "createdAt", dir: "asc" }],
        limit: 2,
        offset: 2,
      });
      expect(p1.items.map((e) => e.id)).toEqual(["e1", "e2"]);
      expect(p2.items.map((e) => e.id)).toEqual(["e3", "e4"]);
      expect(p1.total).toBe(4);
      expect(p2.total).toBe(4);
    });

    // Isolation ------------------------------------------------------------------
    test("entries are isolated per type", async () => {
      const other: ContentTypeDef = { ...productType, name: "page", label: "Page" };
      await c.saveType(other);
      await c.insertEntry({ ...entry({ id: "p1", slug: "keyboard" }), type: "page" });
      // Same slug in another type must not collide or leak.
      expect((await c.getEntryBySlug("product", "keyboard"))?.id).toBe("e1");
      expect((await c.getEntryBySlug("page", "keyboard"))?.id).toBe("p1");
      expect(await c.countEntries("page")).toBe(1);
      expect(await c.countEntries("product")).toBe(4);
    });
  });
}
