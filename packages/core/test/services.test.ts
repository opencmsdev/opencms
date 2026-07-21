import { beforeEach, describe, expect, test } from "bun:test";
import {
  ConflictError,
  ContentTypeService,
  EntryService,
  MemoryDataConnector,
  NotFoundError,
  ValidationError,
} from "@opencms/core";

let data: MemoryDataConnector;
let types: ContentTypeService;
let entries: EntryService;

const articleInput = {
  name: "article",
  label: "Article",
  fields: [
    { name: "title", kind: "text" as const, required: true },
    { name: "views", kind: "number" as const, indexed: true },
    { name: "email", kind: "text" as const, unique: true },
  ],
};

beforeEach(async () => {
  data = new MemoryDataConnector();
  await data.init();
  types = new ContentTypeService(data);
  entries = new EntryService(data);
  await types.create(articleInput);
});

describe("ContentTypeService", () => {
  test("create/get/list/update", async () => {
    const got = await types.get("article");
    expect(got.label).toBe("Article");
    expect(await types.list()).toHaveLength(1);
    const updated = await types.update("article", {
      ...articleInput,
      label: "Articles",
    });
    expect(updated.label).toBe("Articles");
    expect(updated.createdAt).toBe(got.createdAt);
  });

  test("duplicate create conflicts", async () => {
    await expect(types.create(articleInput)).rejects.toThrow(ConflictError);
  });

  test("rename rejected", async () => {
    await expect(
      types.update("article", { ...articleInput, name: "post" })
    ).rejects.toThrow(ConflictError);
  });

  test("delete refuses when entries exist", async () => {
    await entries.create("article", { data: { title: "One" } });
    await expect(types.delete("article")).rejects.toThrow(ConflictError);
  });

  test("delete works when empty", async () => {
    await types.delete("article");
    await expect(types.get("article")).rejects.toThrow(NotFoundError);
  });
});

describe("EntryService", () => {
  test("create derives slug from first text field", async () => {
    const e = await entries.create("article", { data: { title: "Hello World!" } });
    expect(e.slug).toBe("hello-world");
    expect(e.status).toBe("draft");
    expect(e.publishedAt).toBeNull();
  });

  test("slug collision conflicts", async () => {
    await entries.create("article", { data: { title: "Same" } });
    await expect(entries.create("article", { data: { title: "Same" } })).rejects.toThrow(
      ConflictError
    );
  });

  test("explicit invalid slug rejected", async () => {
    await expect(
      entries.create("article", { slug: "Bad Slug", data: { title: "x" } })
    ).rejects.toThrow(ValidationError);
  });

  test("unique field enforced on create and update", async () => {
    await entries.create("article", { data: { title: "A", email: "a@x.com" } });
    await expect(
      entries.create("article", { data: { title: "B", email: "a@x.com" } })
    ).rejects.toThrow(ConflictError);
    const c = await entries.create("article", { data: { title: "C", email: "c@x.com" } });
    await expect(
      entries.update("article", c.id, { data: { email: "a@x.com" } })
    ).rejects.toThrow(ConflictError);
  });

  test("update merges data and revalidates", async () => {
    const e = await entries.create("article", { data: { title: "T", views: 1 } });
    const u = await entries.update("article", e.id, { data: { views: 2 } });
    expect(u.data.title).toBe("T");
    expect(u.data.views).toBe(2);
    await expect(
      entries.update("article", e.id, { data: { views: "nope" as unknown as number } })
    ).rejects.toThrow(ValidationError);
  });

  test("publish sets publishedAt once", async () => {
    const e = await entries.create("article", { data: { title: "P" } });
    const p1 = await entries.publish("article", e.id);
    expect(p1.status).toBe("published");
    expect(p1.publishedAt).not.toBeNull();
    const un = await entries.unpublish("article", e.id);
    expect(un.status).toBe("draft");
    const p2 = await entries.publish("article", e.id);
    expect(p2.publishedAt).toBe(p1.publishedAt);
  });

  test("query validates filter fields", async () => {
    await expect(
      entries.query("article", { filter: [{ field: "ghost", op: "eq", value: 1 }] })
    ).rejects.toThrow(ValidationError);
  });

  test("query clamps limit", async () => {
    const r = await entries.query("article", { limit: 9999 });
    expect(r.limit).toBe(200);
  });

  test("unknown type 404s everywhere", async () => {
    await expect(entries.create("ghost", { data: {} })).rejects.toThrow(NotFoundError);
    await expect(entries.query("ghost")).rejects.toThrow(NotFoundError);
  });
});
