/**
 * The storage connector conformance suite.
 *
 * A StorageConnector is valid if and only if this suite passes against it,
 * the same rule `runDataConnectorSuite` applies to data connectors.
 *
 *   runStorageConnectorSuite("s3", async () => ({
 *     connector: makeConnector(),
 *     cleanup: async (c) => { ... },
 *   }));
 *
 * `MemoryStorageConnector` in @opencms/core is the reference: where the
 * interface leaves a behaviour open, what that class does is the answer, and
 * these tests are where that gets written down.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { StorageConnector } from "@opencms/core";

export interface StorageHarness {
  connector: StorageConnector;
  cleanup?: (connector: StorageConnector) => Promise<void>;
  /**
   * Set when the backend can serve objects over HTTP. Left unset, `publicUrl`
   * is only required to return null rather than throw.
   */
  expectsPublicUrl?: boolean;
}

export type StorageHarnessFactory = () => Promise<StorageHarness>;

const bytes = (s: string) => new TextEncoder().encode(s);

async function readAll(stream: ReadableStream<Uint8Array> | null): Promise<string | null> {
  if (!stream) return null;
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

function streamOf(...parts: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Several chunks on purpose: a connector that only reads the first one
      // passes a single-chunk test and truncates every real upload.
      for (const p of parts) controller.enqueue(bytes(p));
      controller.close();
    },
  });
}

export function runStorageConnectorSuite(name: string, factory: StorageHarnessFactory): void {
  describe(`StorageConnector conformance: ${name}`, () => {
    let harness: StorageHarness;
    let s: StorageConnector;

    beforeEach(async () => {
      harness = await factory();
      s = harness.connector;
    });

    afterEach(async () => {
      await harness.cleanup?.(s);
    });

    describe("put and get", () => {
      test("round-trips bytes with the content type", async () => {
        const info = await s.put("docs/hello.txt", bytes("hello world"), {
          contentType: "text/plain",
        });

        expect(info.key).toBe("docs/hello.txt");
        expect(info.size).toBe(11);
        expect(info.contentType).toBe("text/plain");
        expect(Number.isNaN(Date.parse(info.lastModified))).toBe(false);

        expect(await readAll(await s.get("docs/hello.txt"))).toBe("hello world");
      });

      test("accepts a stream of unknown length and consumes all of it", async () => {
        const info = await s.put("docs/streamed.txt", streamOf("one ", "two ", "three"), {
          contentType: "text/plain",
        });

        expect(info.size).toBe(13);
        expect(await readAll(await s.get("docs/streamed.txt"))).toBe("one two three");
      });

      test("accepts a stream with a declared contentLength", async () => {
        // The path that matters in production: S3 rejects a streamed PUT with
        // no Content-Length, so a connector must either be told the length or
        // buffer. Both must end up with identical bytes.
        const info = await s.put("docs/sized.txt", streamOf("one ", "two ", "three"), {
          contentType: "text/plain",
          contentLength: 13,
        });

        expect(info.size).toBe(13);
        expect(await readAll(await s.get("docs/sized.txt"))).toBe("one two three");
      });

      test("stores bytes verbatim, including binary and empty bodies", async () => {
        const binary = new Uint8Array([0, 1, 2, 250, 251, 255]);
        await s.put("bin/raw", binary, { contentType: "application/octet-stream" });
        const head = await s.head("bin/raw");
        expect(head?.size).toBe(6);

        await s.put("bin/empty", new Uint8Array(0), { contentType: "application/octet-stream" });
        expect((await s.head("bin/empty"))?.size).toBe(0);
        expect(await readAll(await s.get("bin/empty"))).toBe("");
      });

      test("overwrites in place rather than appending or erroring", async () => {
        await s.put("k", bytes("first"), { contentType: "text/plain" });
        const second = await s.put("k", bytes("second"), { contentType: "text/markdown" });

        expect(second.size).toBe(6);
        expect(second.contentType).toBe("text/markdown");
        expect(await readAll(await s.get("k"))).toBe("second");
      });

      test("keeps keys with slashes, spaces and unicode distinct", async () => {
        const keys = ["a/b/c.txt", "a/b c.txt", "a/b+c.txt", "a/café.txt", "a/b%2Fc.txt"];
        for (const [i, key] of keys.entries()) {
          await s.put(key, bytes(`v${i}`), { contentType: "text/plain" });
        }
        for (const [i, key] of keys.entries()) {
          expect(await readAll(await s.get(key))).toBe(`v${i}`);
        }
      });
    });

    describe("missing objects", () => {
      test("get returns null rather than throwing", async () => {
        expect(await s.get("nope/missing.txt")).toBeNull();
      });

      test("head returns null rather than throwing", async () => {
        expect(await s.head("nope/missing.txt")).toBeNull();
      });

      test("delete of an absent key is a no-op", async () => {
        await s.delete("nope/missing.txt");
        await s.delete("nope/missing.txt");
      });
    });

    describe("head", () => {
      test("reports the same metadata as put, without the body", async () => {
        const put = await s.put("meta/thing.json", bytes('{"a":1}'), {
          contentType: "application/json",
        });
        const head = await s.head("meta/thing.json");

        expect(head?.key).toBe("meta/thing.json");
        expect(head?.size).toBe(put.size);
        expect(head?.contentType).toBe("application/json");
      });
    });

    describe("delete", () => {
      test("removes the object", async () => {
        await s.put("gone.txt", bytes("x"), { contentType: "text/plain" });
        await s.delete("gone.txt");

        expect(await s.head("gone.txt")).toBeNull();
        expect(await s.get("gone.txt")).toBeNull();
      });

      test("leaves neighbouring keys alone", async () => {
        await s.put("p/one", bytes("1"), { contentType: "text/plain" });
        await s.put("p/one-more", bytes("2"), { contentType: "text/plain" });
        await s.delete("p/one");

        expect(await s.head("p/one")).toBeNull();
        expect((await s.head("p/one-more"))?.size).toBe(1);
      });
    });

    describe("list", () => {
      beforeEach(async () => {
        for (const key of ["m/a.txt", "m/b.txt", "m/c.txt", "n/d.txt"]) {
          await s.put(key, bytes(key), { contentType: "text/plain" });
        }
      });

      test("filters by prefix", async () => {
        const { objects } = await s.list("m/");
        expect(objects.map((o) => o.key)).toEqual(["m/a.txt", "m/b.txt", "m/c.txt"]);
      });

      test("returns keys sorted ascending", async () => {
        await s.put("m/A.txt", bytes("A"), { contentType: "text/plain" });
        const { objects } = await s.list("m/");
        const keys = objects.map((o) => o.key);
        expect(keys).toEqual([...keys].sort());
      });

      test("an empty prefix lists everything", async () => {
        const { objects } = await s.list("");
        expect(objects.length).toBe(4);
      });

      test("a prefix matching nothing gives an empty page and no cursor", async () => {
        const page = await s.list("zzz/");
        expect(page.objects).toEqual([]);
        expect(page.cursor).toBeUndefined();
      });

      test("carries a correct size on every entry", async () => {
        const { objects } = await s.list("m/");
        for (const o of objects) {
          expect(o.size).toBe(o.key.length);
          expect(Number.isNaN(Date.parse(o.lastModified))).toBe(false);
        }
      });

      test("either omits contentType or reports the real one, never invents it", async () => {
        // S3's ListObjectsV2 carries no content type, so the contract makes it
        // optional. What is not allowed is filling it with a plausible default
        // that a caller cannot tell apart from a real answer.
        const { objects } = await s.list("m/");
        for (const o of objects) {
          if (o.contentType !== undefined) expect(o.contentType).toBe("text/plain");
        }
      });

      test("pages with a cursor and terminates", async () => {
        const seen: string[] = [];
        let cursor: string | undefined;
        // Bounded so a connector that returns a cursor forever fails here
        // rather than hanging the suite.
        for (let guard = 0; guard < 10; guard++) {
          const page = await s.list("m/", { limit: 2, cursor });
          expect(page.objects.length).toBeLessThanOrEqual(2);
          seen.push(...page.objects.map((o) => o.key));
          cursor = page.cursor;
          if (!cursor) break;
        }

        expect(cursor).toBeUndefined();
        expect(seen).toEqual(["m/a.txt", "m/b.txt", "m/c.txt"]);
      });

      test("does not return a cursor on the last page", async () => {
        const page = await s.list("m/", { limit: 3 });
        expect(page.objects.length).toBe(3);
        expect(page.cursor).toBeUndefined();
      });
    });

    describe("publicUrl", () => {
      test("returns a usable URL or null, never throws", async () => {
        await s.put("pub/img.png", bytes("png"), { contentType: "image/png" });
        const url = await s.publicUrl("pub/img.png");

        if (harness.expectsPublicUrl) {
          expect(typeof url).toBe("string");
          expect(() => new URL(url as string)).not.toThrow();
          expect(url).toContain("pub/img.png");
        } else {
          expect(url).toBeNull();
        }
      });
    });
  });
}
