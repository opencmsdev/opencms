import { beforeEach, describe, expect, test } from "bun:test";
import {
  ConflictError,
  ContentTypeService,
  EntryService,
  MemoryDataConnector,
  NotFoundError,
  ValidationError,
} from "@opencms/core";
import type { Clock, ContentTypeDef, ContentTypeInput } from "@opencms/core";

/** Records the calls a service makes, so we can assert on index maintenance. */
class SpyConnector extends MemoryDataConnector {
  ensureIndexesCalls: string[] = [];
  saveTypeCalls: string[] = [];

  override async ensureIndexes(def: ContentTypeDef): Promise<void> {
    this.ensureIndexesCalls.push(def.name);
    await super.ensureIndexes(def);
  }

  override async saveType(def: ContentTypeDef): Promise<void> {
    this.saveTypeCalls.push(def.name);
    await super.saveType(def);
  }
}

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-06-15T12:00:00.000Z";

let data: SpyConnector;
let types: ContentTypeService;
let now: Date;
const clock: Clock = () => now;

const article: ContentTypeInput = {
  name: "article",
  label: "Article",
  fields: [{ name: "title", kind: "text", required: true }],
};

beforeEach(async () => {
  now = new Date(T0);
  data = new SpyConnector();
  await data.init();
  types = new ContentTypeService(data, clock);
});

describe("ContentTypeService.list", () => {
  test("returns an empty array on a fresh store", async () => {
    expect(await types.list()).toEqual([]);
  });

  test("returns types sorted by machine name", async () => {
    await types.create({ name: "zebra", label: "Zebra", fields: [] });
    await types.create({ name: "article", label: "Article", fields: [] });
    await types.create({ name: "medium", label: "Medium", fields: [] });
    expect((await types.list()).map((t) => t.name)).toEqual(["article", "medium", "zebra"]);
  });
});

describe("ContentTypeService.create", () => {
  test("stamps createdAt and updatedAt from the injected clock", async () => {
    const def = await types.create(article);
    expect(def.createdAt).toBe(T0);
    expect(def.updatedAt).toBe(T0);
  });

  test("maintains indexes for the new type", async () => {
    await types.create(article);
    expect(data.ensureIndexesCalls).toEqual(["article"]);
  });

  test("rejects an invalid definition before touching the connector", async () => {
    await expect(
      types.create({ name: "Bad Name", label: "Bad", fields: [] })
    ).rejects.toThrow(ValidationError);
    expect(data.saveTypeCalls).toEqual([]);
    expect(data.ensureIndexesCalls).toEqual([]);
  });

  test("rejects a duplicate name with the type in the message", async () => {
    await types.create(article);
    await expect(types.create(article)).rejects.toThrow(
      /content type "article" already exists/
    );
  });
});

describe("ContentTypeService.update", () => {
  beforeEach(async () => {
    await types.create(article);
  });

  test("advances updatedAt while preserving createdAt", async () => {
    now = new Date(T1);
    const def = await types.update("article", { ...article, label: "Articles" });
    expect(def.createdAt).toBe(T0);
    expect(def.updatedAt).toBe(T1);
    expect(def.label).toBe("Articles");
  });

  test("can add and remove fields, and the change is what get returns", async () => {
    await types.update("article", {
      ...article,
      fields: [
        { name: "title", kind: "text", required: true },
        { name: "views", kind: "number", indexed: true },
      ],
    });
    let def = await types.get("article");
    expect(def.fields.map((f) => f.name)).toEqual(["title", "views"]);

    await types.update("article", { ...article, fields: [{ name: "views", kind: "number" }] });
    def = await types.get("article");
    expect(def.fields.map((f) => f.name)).toEqual(["views"]);
  });

  test("re-runs index maintenance", async () => {
    await types.update("article", { ...article, label: "Articles" });
    expect(data.ensureIndexesCalls).toEqual(["article", "article"]);
  });

  test("rejects an unknown type", async () => {
    await expect(types.update("ghost", { ...article, name: "ghost" })).rejects.toThrow(
      NotFoundError
    );
  });

  test("rejects an invalid body", async () => {
    await expect(types.update("article", { ...article, label: "" })).rejects.toThrow(
      ValidationError
    );
  });

  test("reports an unknown type before an invalid body", async () => {
    // get() runs first, so a typo in the URL is not masked by a bad payload.
    await expect(types.update("ghost", { ...article, label: "" })).rejects.toThrow(NotFoundError);
  });

  test("refuses a rename", async () => {
    await expect(types.update("article", { ...article, name: "post" })).rejects.toThrow(
      /renaming a content type is not supported yet/
    );
  });
});

describe("ContentTypeService.delete", () => {
  beforeEach(async () => {
    await types.create(article);
  });

  test("rejects an unknown type", async () => {
    await expect(types.delete("ghost")).rejects.toThrow(NotFoundError);
  });

  test("reports how many entries are in the way", async () => {
    const entries = new EntryService(data, clock);
    await entries.create("article", { data: { title: "One" } });
    await entries.create("article", { data: { title: "Two" } });
    await expect(types.delete("article")).rejects.toThrow(
      /content type "article" still has 2 entries; delete them first/
    );
  });

  test("succeeds once the entries are gone", async () => {
    const entries = new EntryService(data, clock);
    const entry = await entries.create("article", { data: { title: "One" } });
    await expect(types.delete("article")).rejects.toThrow(ConflictError);
    await entries.delete("article", entry.id);
    await types.delete("article");
    await expect(types.get("article")).rejects.toThrow(NotFoundError);
  });
});
