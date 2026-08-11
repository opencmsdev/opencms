import { beforeEach, describe, expect, test } from "bun:test";
import { MemoryStorageConnector } from "@opencms/core";
import {
  createEditor,
  createTestApp,
  type TestContext,
} from "./helpers.ts";

/**
 * The media routes end to end: multipart upload, anonymous serving, listing,
 * deletion, and the unconfigured fallback. RBAC edges live here rather than
 * auth.test.ts because the media routes are the only multipart surface.
 */

let ctx: TestContext;
let storage: MemoryStorageConnector;

interface UploadedMedia {
  key: string;
  url: string;
  size: number;
  contentType: string;
}

interface MediaPage {
  objects: Array<{ key: string }>;
  cursor?: string;
}

const jsonOf = <T,>(res: Response): Promise<T> => res.json() as Promise<T>;

beforeEach(async () => {
  storage = new MemoryStorageConnector();
  ctx = await createTestApp({ storage });
});

function upload(
  name: string,
  content: string,
  type: string,
  cookie?: string
): Promise<Response> {
  const form = new FormData();
  form.set("file", new File([content], name, { type }));
  return Promise.resolve(ctx.app.request("/api/media", {
    method: "POST",
    body: form,
    headers: cookie === undefined ? { cookie: ctx.adminCookie } : { cookie },
  }));
}

describe("media upload", () => {
  test("multipart upload returns 201 with key, url and metadata", async () => {
    const res = await upload("Team Photo.png", "fake-png-bytes", "image/png");
    expect(res.status).toBe(201);
    const body = await jsonOf<UploadedMedia>(res);
    expect(body.key).toMatch(/^\d{4}\/\d{2}\/team-photo-[a-z0-9-]{8}\.png$/);
    expect(body.url).toBe(`/api/media/${body.key}`);
    expect(body.size).toBe(14);
    expect(body.contentType).toBe("image/png");
  });

  test("a body that is not multipart with a `file` part is a 400", async () => {
    const res = await ctx.app.request("/api/media", {
      method: "POST",
      body: JSON.stringify({ nope: true }),
      headers: { "content-type": "application/json", cookie: ctx.adminCookie },
    });
    expect(res.status).toBe(400);
  });

  test("anonymous upload is 401, an editor's upload succeeds", async () => {
    const anon = await upload("x.png", "x", "image/png", "");
    expect(anon.status).toBe(401);

    const editorCookie = await createEditor(ctx);
    const ok = await upload("x.png", "x", "image/png", editorCookie);
    expect(ok.status).toBe(201);
  });
});

describe("media serving", () => {
  test("anyone can read an uploaded object back, byte for byte", async () => {
    const up = await jsonOf<UploadedMedia>(await upload("hello.txt", "hello media", "text/plain"));

    // No cookie at all: the anonymous read path.
    const res = await ctx.app.request(`/api/media/${up.key}`);
    expect(res.status).toBe(200);
    // Multipart parsing may normalize a charset onto the part's type.
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("content-length")).toBe("11");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(await res.text()).toBe("hello media");
  });

  test("a missing key is 404, a traversal key is 400", async () => {
    const missing = await ctx.app.request("/api/media/2026/08/never-was.png");
    expect(missing.status).toBe(404);

    // Encoded so the dot segments survive URL normalization and reach the API.
    const sneaky = await ctx.app.request("/api/media/a%2F..%2Fb");
    expect(sneaky.status).toBe(400);
  });

  test("a storage backend with a public URL gets a redirect instead of bytes", async () => {
    class PublicStorage extends MemoryStorageConnector {
      override async publicUrl(key: string): Promise<string | null> {
        return `https://cdn.example.com/${key}`;
      }
    }
    const publicCtx = await createTestApp({ storage: new PublicStorage() });
    const form = new FormData();
    form.set("file", new File(["x"], "x.png", { type: "image/png" }));
    const up = await jsonOf<UploadedMedia>(
      await publicCtx.app.request("/api/media", {
        method: "POST",
        body: form,
        headers: { cookie: publicCtx.adminCookie },
      })
    );

    const res = await publicCtx.app.request(`/api/media/${up.key}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`https://cdn.example.com/${up.key}`);
  });
});

describe("media listing and deletion", () => {
  test("listing pages with an opaque cursor and requires a role", async () => {
    for (let i = 0; i < 3; i++) await upload(`file-${i}.txt`, "x", "text/plain");

    const anon = await ctx.app.request("/api/media");
    expect(anon.status).toBe(401);

    const first = await ctx.app.request("/api/media?limit=2", {
      headers: { cookie: ctx.adminCookie },
    });
    expect(first.status).toBe(200);
    const page1 = await jsonOf<MediaPage>(first);
    expect(page1.objects).toHaveLength(2);
    expect(page1.cursor).toBeDefined();

    const rest = await ctx.app.request(
      `/api/media?limit=2&cursor=${encodeURIComponent(page1.cursor ?? "")}`,
      { headers: { cookie: ctx.adminCookie } }
    );
    const page2 = await jsonOf<MediaPage>(rest);
    expect(page2.objects).toHaveLength(1);
    expect(page2.cursor).toBeUndefined();
  });

  test("delete is 204, idempotent, and requires a role", async () => {
    const up = await jsonOf<UploadedMedia>(await upload("bye.txt", "x", "text/plain"));

    const anon = await ctx.app.request(`/api/media/${up.key}`, { method: "DELETE" });
    expect(anon.status).toBe(401);

    const del = await ctx.app.request(`/api/media/${up.key}`, {
      method: "DELETE",
      headers: { cookie: ctx.adminCookie },
    });
    expect(del.status).toBe(204);

    const gone = await ctx.app.request(`/api/media/${up.key}`);
    expect(gone.status).toBe(404);

    const again = await ctx.app.request(`/api/media/${up.key}`, {
      method: "DELETE",
      headers: { cookie: ctx.adminCookie },
    });
    expect(again.status).toBe(204);
  });
});

describe("without a storage connector", () => {
  test("setup reports media:false and every media route is a clear 404", async () => {
    const bare = await createTestApp();

    const setup = await bare.app.request("/api/setup");
    expect(((await setup.json()) as { media: boolean }).media).toBe(false);

    const form = new FormData();
    form.set("file", new File(["x"], "x.png", { type: "image/png" }));
    const up = await bare.app.request("/api/media", {
      method: "POST",
      body: form,
      headers: { cookie: bare.adminCookie },
    });
    expect(up.status).toBe(404);
    expect(((await up.json()) as { message: string }).message).toContain("storage connector");

    const list = await bare.app.request("/api/media", {
      headers: { cookie: bare.adminCookie },
    });
    expect(list.status).toBe(404);
  });

  test("setup reports media:true when storage is configured", async () => {
    const setup = await ctx.app.request("/api/setup");
    expect(((await setup.json()) as { media: boolean }).media).toBe(true);
  });
});
