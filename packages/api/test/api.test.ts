import { beforeEach, describe, expect, test } from "bun:test";
import type { Hono } from "hono";
import { MemoryDataConnector } from "@opencms/core";
import { createApp } from "@opencms/api";

let app: Hono;

const articleType = {
  name: "article",
  label: "Article",
  fields: [
    { name: "title", kind: "text", required: true },
    { name: "views", kind: "number", indexed: true },
  ],
};

async function req(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: any }> {
  const res = await app.request(path, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(async () => {
  const data = new MemoryDataConnector();
  await data.init();
  app = createApp({ data });
  await app.request("/api/content-types", json("POST", articleType));
});

describe("content types API", () => {
  test("create returns 201, get and list work", async () => {
    const list = await req("/api/content-types");
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);

    const got = await req("/api/content-types/article");
    expect(got.status).toBe(200);
    expect(got.body.label).toBe("Article");
  });

  test("duplicate create is 409, bad definition is 400, missing is 404", async () => {
    const dup = await req("/api/content-types", json("POST", articleType));
    expect(dup.status).toBe(409);

    const bad = await req(
      "/api/content-types",
      json("POST", { name: "Bad Name", label: "x", fields: [] })
    );
    expect(bad.status).toBe(400);
    expect(bad.body.issues.length).toBeGreaterThan(0);

    expect((await req("/api/content-types/ghost")).status).toBe(404);
  });

  test("update and delete", async () => {
    const up = await req(
      "/api/content-types/article",
      json("PUT", { ...articleType, label: "Articles" })
    );
    expect(up.status).toBe(200);
    expect(up.body.label).toBe("Articles");

    const del = await req("/api/content-types/article", { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await req("/api/content-types/article")).status).toBe(404);
  });
});

describe("entries API", () => {
  test("full lifecycle: create, read, update, publish, delete", async () => {
    const created = await req(
      "/api/content/article",
      json("POST", { data: { title: "Hello World", views: 1 } })
    );
    expect(created.status).toBe(201);
    expect(created.body.slug).toBe("hello-world");
    const id = created.body.id;

    const bySlug = await req("/api/content/article/slug/hello-world");
    expect(bySlug.body.id).toBe(id);

    const patched = await req(
      `/api/content/article/${id}`,
      json("PATCH", { data: { views: 2 } })
    );
    expect(patched.body.data.views).toBe(2);
    expect(patched.body.data.title).toBe("Hello World");

    const published = await req(`/api/content/article/${id}/publish`, { method: "POST" });
    expect(published.body.status).toBe("published");
    expect(published.body.publishedAt).not.toBeNull();

    const del = await req(`/api/content/article/${id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    expect((await req(`/api/content/article/${id}`)).status).toBe(404);
  });

  test("validation errors are 400 with issues", async () => {
    const missing = await req("/api/content/article", json("POST", { data: {} }));
    expect(missing.status).toBe(400);
    expect(missing.body.error).toBe("validation");

    const wrongKind = await req(
      "/api/content/article",
      json("POST", { data: { title: "x", views: "many" } })
    );
    expect(wrongKind.status).toBe(400);
  });

  test("slug conflict is 409", async () => {
    await req("/api/content/article", json("POST", { data: { title: "Same" } }));
    const dup = await req("/api/content/article", json("POST", { data: { title: "Same" } }));
    expect(dup.status).toBe(409);
  });

  test("query: where, status, sort, pagination", async () => {
    for (let i = 1; i <= 5; i++) {
      await req(
        "/api/content/article",
        json("POST", {
          status: i % 2 === 0 ? "published" : "draft",
          data: { title: `Post ${i}`, views: i * 10 },
        })
      );
    }

    const where = encodeURIComponent(JSON.stringify([{ field: "views", op: "gte", value: 30 }]));
    const filtered = await req(`/api/content/article?where=${where}&sort=views:asc`);
    expect(filtered.body.items.map((e: any) => e.data.views)).toEqual([30, 40, 50]);
    expect(filtered.body.total).toBe(3);

    const published = await req("/api/content/article?status=published&sort=views:asc");
    expect(published.body.items.map((e: any) => e.data.views)).toEqual([20, 40]);

    const page = await req("/api/content/article?sort=views:asc&limit=2&offset=2");
    expect(page.body.items.map((e: any) => e.data.views)).toEqual([30, 40]);
    expect(page.body.total).toBe(5);
  });

  test("bad query inputs are 400", async () => {
    expect((await req("/api/content/article?where=notjson")).status).toBe(400);
    expect((await req("/api/content/article?sort=views:sideways")).status).toBe(400);
    expect((await req("/api/content/article?limit=abc")).status).toBe(400);
    const ghostField = encodeURIComponent(
      JSON.stringify([{ field: "ghost", op: "eq", value: 1 }])
    );
    expect((await req(`/api/content/article?where=${ghostField}`)).status).toBe(400);
  });

  test("unknown type is 404", async () => {
    expect((await req("/api/content/ghost")).status).toBe(404);
    expect((await req("/api/content/ghost", json("POST", { data: {} }))).status).toBe(404);
  });

  test("health", async () => {
    expect((await req("/health")).body.ok).toBe(true);
  });
});
