import { beforeEach, describe, expect, test } from "bun:test";
import { MemoryCacheConnector } from "@opencms/core";
import { createTestApp, json, type TestContext } from "./helpers.ts";

/**
 * The anonymous read cache end to end: hits, misses, role bypass, and
 * generation-based invalidation on every write path. Runs on the memory
 * connector; the KV connector proves itself against the same CacheConnector
 * contract in its own conformance test.
 */

let ctx: TestContext;

const articleType = {
  name: "article",
  label: "Article",
  fields: [
    { name: "title", kind: "text", required: true },
    { name: "views", kind: "number" },
  ],
};

async function adminReq(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("cookie", ctx.adminCookie);
  return ctx.app.request(path, { ...init, headers });
}

/** An anonymous GET, returning the response for header inspection. */
function anonGet(path: string): Promise<Response> {
  return Promise.resolve(ctx.app.request(path));
}

async function publishArticle(title: string): Promise<{ id: string; slug: string }> {
  const res = await adminReq(
    "/api/content/article",
    json("POST", { status: "published", data: { title } })
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; slug: string };
}

beforeEach(async () => {
  ctx = await createTestApp({
    cache: { connector: new MemoryCacheConnector(), ttlSeconds: 60 },
  });
  await adminReq("/api/content-types", json("POST", articleType));
});

describe("anonymous read caching", () => {
  test("second identical read is a hit, different query is its own miss", async () => {
    await publishArticle("First post");

    const miss = await anonGet("/api/content/article");
    expect(miss.status).toBe(200);
    expect(miss.headers.get("x-opencms-cache")).toBe("miss");

    const hit = await anonGet("/api/content/article");
    expect(hit.headers.get("x-opencms-cache")).toBe("hit");
    expect(await hit.json()).toEqual(await miss.json());

    const other = await anonGet("/api/content/article?limit=1");
    expect(other.headers.get("x-opencms-cache")).toBe("miss");
  });

  test("by-id and by-slug reads cache too", async () => {
    const { id, slug } = await publishArticle("Addressable");

    expect((await anonGet(`/api/content/article/${id}`)).headers.get("x-opencms-cache")).toBe("miss");
    expect((await anonGet(`/api/content/article/${id}`)).headers.get("x-opencms-cache")).toBe("hit");

    expect(
      (await anonGet(`/api/content/article/slug/${slug}`)).headers.get("x-opencms-cache")
    ).toBe("miss");
    expect(
      (await anonGet(`/api/content/article/slug/${slug}`)).headers.get("x-opencms-cache")
    ).toBe("hit");
  });

  test("authenticated reads never touch the cache", async () => {
    await publishArticle("Secretly counted");
    await anonGet("/api/content/article"); // primes the anonymous cache

    const authed = await adminReq("/api/content/article");
    expect(authed.headers.get("x-opencms-cache")).toBeNull();
  });

  test("a draft 404 is not cached, so publishing is visible immediately", async () => {
    const draft = await adminReq(
      "/api/content/article",
      json("POST", { data: { title: "Not yet" } })
    );
    const { id } = (await draft.json()) as { id: string };

    expect((await anonGet(`/api/content/article/${id}`)).status).toBe(404);

    await adminReq(`/api/content/article/${id}/publish`, { method: "POST" });
    const after = await anonGet(`/api/content/article/${id}`);
    expect(after.status).toBe(200);
  });
});

describe("invalidation", () => {
  test("every entry write bumps the type's generation", async () => {
    const { id } = await publishArticle("v1");

    const prime = async () => {
      await anonGet("/api/content/article");
      expect((await anonGet("/api/content/article")).headers.get("x-opencms-cache")).toBe("hit");
    };

    await prime();
    await adminReq(`/api/content/article/${id}`, json("PATCH", { data: { title: "v2" } }));
    const afterUpdate = await anonGet("/api/content/article");
    expect(afterUpdate.headers.get("x-opencms-cache")).toBe("miss");
    expect(((await afterUpdate.json()) as { items: { data: { title: string } }[] }).items[0]?.data.title).toBe("v2");

    await prime();
    await adminReq(`/api/content/article/${id}/unpublish`, { method: "POST" });
    expect((await anonGet("/api/content/article")).headers.get("x-opencms-cache")).toBe("miss");

    await prime();
    await adminReq(`/api/content/article/${id}`, { method: "DELETE" });
    const afterDelete = await anonGet("/api/content/article");
    expect(afterDelete.headers.get("x-opencms-cache")).toBe("miss");
    expect(((await afterDelete.json()) as { total: number }).total).toBe(0);
  });

  test("schema writes invalidate the type as well", async () => {
    await publishArticle("Schema victim");
    await anonGet("/api/content/article");
    expect((await anonGet("/api/content/article")).headers.get("x-opencms-cache")).toBe("hit");

    await adminReq(
      "/api/content-types/article",
      json("PUT", {
        ...articleType,
        fields: [...articleType.fields, { name: "extra", kind: "text" }],
      })
    );
    expect((await anonGet("/api/content/article")).headers.get("x-opencms-cache")).toBe("miss");
  });

  test("types are invalidated independently", async () => {
    await adminReq(
      "/api/content-types",
      json("POST", { name: "aside", label: "Aside", fields: [{ name: "title", kind: "text" }] })
    );
    await publishArticle("Stays cached");
    await anonGet("/api/content/article");
    expect((await anonGet("/api/content/article")).headers.get("x-opencms-cache")).toBe("hit");

    // Writing an `aside` must not evict `article` reads.
    await adminReq("/api/content/aside", json("POST", { status: "published", data: { title: "x" } }));
    expect((await anonGet("/api/content/article")).headers.get("x-opencms-cache")).toBe("hit");
  });
});

describe("without a cache", () => {
  test("responses carry no cache header and reads work unchanged", async () => {
    const bare = await createTestApp();
    const res = await bare.app.request("/api/content-types", {
      headers: { cookie: bare.adminCookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-opencms-cache")).toBeNull();
  });
});
