import { beforeEach, describe, expect, test } from "bun:test";
import type { ContentTypeDef } from "@opencms/core";
import { SQLiteDataConnector } from "@opencms/connector-sqlite";

/**
 * Proves the performance claim behind the dynamic-type model: a field
 * flagged `indexed: true` produces a real expression index that the query
 * planner actually uses, and dropping the flag removes it.
 */

const productType: ContentTypeDef = {
  name: "product",
  label: "Product",
  fields: [
    { name: "title", kind: "text", required: true },
    { name: "price", kind: "number", indexed: true },
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let c: SQLiteDataConnector;

beforeEach(async () => {
  c = new SQLiteDataConnector();
  await c.init();
  await c.saveType(productType);
  await c.ensureIndexes(productType);
});

function planFor(sql: string, params: (string | number)[]): string {
  const rows = c.db
    .query<{ detail: string }, (string | number)[]>(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params);
  return rows.map((r) => r.detail).join(" | ");
}

describe("JSON expression indexes", () => {
  test("filter on an indexed data field uses the index", () => {
    const plan = planFor(
      "SELECT * FROM entries WHERE type = ? AND json_extract(data, '$.price') < ?",
      ["product", 100]
    );
    expect(plan).toContain("USING INDEX idx_e_product_price");
  });

  test("filter on a non-indexed data field scans", () => {
    const plan = planFor(
      "SELECT * FROM entries WHERE type = ? AND json_extract(data, '$.title') = ?",
      ["product", "x"]
    );
    expect(plan).not.toContain("idx_e_product_title");
  });

  test("ensureIndexes is idempotent and drops stale indexes", async () => {
    await c.ensureIndexes(productType);
    await c.ensureIndexes(productType);

    const without: ContentTypeDef = {
      ...productType,
      fields: [
        { name: "title", kind: "text", required: true },
        { name: "price", kind: "number" }, // indexed flag removed
      ],
    };
    await c.ensureIndexes(without);
    const names = c.db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_e_%'"
      )
      .all()
      .map((r) => r.name);
    expect(names).not.toContain("idx_e_product_price");
  });

  test("indexed query stays fast on a large table", async () => {
    const insert = c.db.query(
      `INSERT INTO entries (id, type, slug, status, data, created_at, updated_at, published_at)
       VALUES (?, 'product', ?, 'published', ?, '2026-01-01', '2026-01-01', NULL)`
    );
    const tx = c.db.transaction(() => {
      for (let i = 0; i < 20000; i++) {
        insert.run(`id${i}`, `slug-${i}`, JSON.stringify({ title: `P${i}`, price: i % 1000 }));
      }
    });
    tx();

    const t0 = performance.now();
    const r = await c.queryEntries("product", {
      filter: [{ field: "price", op: "eq", value: 500 }],
      limit: 50,
    });
    const ms = performance.now() - t0;
    expect(r.total).toBe(20);
    // Generous bound: an index lookup on 20k rows is sub-millisecond;
    // a scan with per-row JSON parsing would blow well past this.
    expect(ms).toBeLessThan(25);
  });
});
