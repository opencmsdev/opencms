import { describe, expect, test } from "bun:test";
import { MediaService, MemoryStorageConnector, NotFoundError, ValidationError } from "../src";

/** Deterministic service: pinned clock, sequential ids (EntryService pattern). */
function makeService(now = new Date("2026-08-11T10:00:00Z")) {
  const storage = new MemoryStorageConnector(() => now);
  let n = 0;
  const svc = new MediaService(storage, () => now, () => `id${++n}00000000`);
  return { svc, storage };
}

const bytes = (s: string) => new TextEncoder().encode(s);

describe("MediaService key generation", () => {
  test("keys are date-prefixed, slugified and id-suffixed", async () => {
    const { svc } = makeService();
    const info = await svc.upload("My Summer Photo.PNG", bytes("x"), {
      contentType: "image/png",
    });
    expect(info.key).toBe("2026/08/my-summer-photo-id100000.png");
  });

  test("re-uploading the same filename never overwrites", async () => {
    const { svc } = makeService();
    const a = await svc.upload("logo.svg", bytes("a"), { contentType: "image/svg+xml" });
    const b = await svc.upload("logo.svg", bytes("b"), { contentType: "image/svg+xml" });
    expect(a.key).not.toBe(b.key);
  });

  test("an unusable extension is dropped, an unusable base becomes `file`", async () => {
    const { svc } = makeService();
    const noExt = await svc.upload("README", bytes("x"), {});
    expect(noExt.key).toBe("2026/08/readme-id100000");

    const badExt = await svc.upload("archive.tar¡gz!", bytes("x"), {});
    expect(badExt.key.endsWith("id200000")).toBe(true);

    const badBase = await svc.upload("¡¡¡.png", bytes("x"), {});
    expect(badBase.key).toBe("2026/08/file-id300000.png");
  });

  test("a dotfile's name is its base, not its extension", async () => {
    const { svc } = makeService();
    const info = await svc.upload(".env", bytes("x"), {});
    expect(info.key).toBe("2026/08/env-id100000");
  });

  test("an empty filename is rejected", async () => {
    const { svc } = makeService();
    expect(svc.upload("   ", bytes("x"), {})).rejects.toThrow(ValidationError);
  });
});

describe("MediaService serve and delete", () => {
  test("serve returns metadata and the exact bytes", async () => {
    const { svc } = makeService();
    const info = await svc.upload("note.txt", bytes("hello media"), {
      contentType: "text/plain",
    });
    const served = await svc.serve(info.key);
    expect(served.info.contentType).toBe("text/plain");
    expect(served.info.size).toBe(11);
    expect(await new Response(served.body).text()).toBe("hello media");
  });

  test("serving a missing key is NotFound", async () => {
    const { svc } = makeService();
    expect(svc.serve("2026/08/nope.png")).rejects.toThrow(NotFoundError);
  });

  test("delete is idempotent and removes the object", async () => {
    const { svc } = makeService();
    const info = await svc.upload("gone.txt", bytes("x"), {});
    await svc.delete(info.key);
    await svc.delete(info.key); // second delete is a no-op, as on S3
    expect(svc.serve(info.key)).rejects.toThrow(NotFoundError);
  });

  test.each([
    ["2026/../secrets", "traversal"],
    ["/2026/08/x.png", "leading slash"],
    ["2026//x.png", "empty segment"],
    ["2026/08/a b.png", "whitespace"],
    ["2026\\08\\x.png", "backslash"],
    ["", "empty"],
  ])("unsafe key %p (%s) is rejected everywhere", async (key) => {
    const { svc } = makeService();
    expect(svc.serve(key)).rejects.toThrow(ValidationError);
    expect(svc.delete(key)).rejects.toThrow(ValidationError);
    expect(svc.publicUrl(key)).rejects.toThrow(ValidationError);
  });
});

describe("MediaService listing", () => {
  test("limit is clamped and the cursor pages through everything", async () => {
    const { svc } = makeService();
    for (let i = 0; i < 5; i++) await svc.upload(`file-${i}.txt`, bytes("x"), {});

    const clamped = await svc.list({ limit: 0 });
    expect(clamped.objects).toHaveLength(1); // 0 clamps up to 1

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await svc.list({ limit: 2, cursor });
      seen.push(...page.objects.map((o) => o.key));
      cursor = page.cursor;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  test("prefix narrows the listing", async () => {
    const { svc, storage } = makeService();
    await storage.put("2025/12/old.txt", bytes("x"), { contentType: "text/plain" });
    await svc.upload("new.txt", bytes("x"), {});
    const page = await svc.list({ prefix: "2026/" });
    expect(page.objects.map((o) => o.key)).toEqual(["2026/08/new-id100000.txt"]);
  });
});
