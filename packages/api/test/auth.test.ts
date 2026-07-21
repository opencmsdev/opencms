import { beforeEach, describe, expect, test } from "bun:test";
import {
  ADMIN,
  createApiKey,
  createEditor,
  createTestApp,
  json,
  type TestContext,
} from "./helpers.ts";

let ctx: TestContext;

const articleType = {
  name: "article",
  label: "Article",
  fields: [{ name: "title", kind: "text", required: true }],
};

async function req(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: any }> {
  const res = await ctx.app.request(path, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

beforeEach(async () => {
  ctx = await createTestApp();
  await ctx.app.request("/api/content-types", json("POST", articleType, ctx.adminCookie));
});

describe("bootstrap", () => {
  test("the first user is the admin", async () => {
    const session = await req("/api/auth/get-session", {
      headers: { cookie: ctx.adminCookie },
    });
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe(ADMIN.email);
    expect(session.body.user.role).toBe("admin");
  });

  test("signup closes after the first user", async () => {
    const second = await req(
      "/api/auth/sign-up/email",
      json("POST", { email: "late@opencms.test", password: "password-123456", name: "Late" })
    );
    expect(second.status).toBe(403);
  });
});

describe("sessions and RBAC", () => {
  test("anonymous writes are 401", async () => {
    expect((await req("/api/content/article", json("POST", { data: { title: "x" } }))).status).toBe(401);
    expect((await req("/api/content-types", json("POST", articleType))).status).toBe(401);
    expect((await req("/api/content-types")).status).toBe(401);
  });

  test("editors manage content but not schema", async () => {
    const editorCookie = await createEditor(ctx);

    const entry = await req(
      "/api/content/article",
      json("POST", { data: { title: "By Editor" } }, editorCookie)
    );
    expect(entry.status).toBe(201);

    const publish = await req(`/api/content/article/${entry.body.id}/publish`, {
      method: "POST",
      headers: { cookie: editorCookie },
    });
    expect(publish.status).toBe(200);

    const readTypes = await req("/api/content-types", { headers: { cookie: editorCookie } });
    expect(readTypes.status).toBe(200);

    const writeType = await req(
      "/api/content-types",
      json("POST", { name: "page", label: "Page", fields: [] }, editorCookie)
    );
    expect(writeType.status).toBe(403);

    const dropType = await req("/api/content-types/article", {
      method: "DELETE",
      headers: { cookie: editorCookie },
    });
    expect(dropType.status).toBe(403);
  });

  test("admins manage schema", async () => {
    const created = await req(
      "/api/content-types",
      json("POST", { name: "page", label: "Page", fields: [] }, ctx.adminCookie)
    );
    expect(created.status).toBe(201);
  });
});

describe("API keys", () => {
  test("an editor key manages content but not schema", async () => {
    const key = await createApiKey(ctx, "editor");

    const entry = await req("/api/content/article", {
      ...json("POST", { data: { title: "By Key" } }),
      headers: { "content-type": "application/json", "x-api-key": key },
    });
    expect(entry.status).toBe(201);

    const type = await req("/api/content-types", {
      ...json("POST", { name: "page", label: "Page", fields: [] }),
      headers: { "content-type": "application/json", "x-api-key": key },
    });
    expect(type.status).toBe(403);
  });

  test("an admin key manages schema", async () => {
    const key = await createApiKey(ctx, "admin");
    const type = await req("/api/content-types", {
      ...json("POST", { name: "page", label: "Page", fields: [] }),
      headers: { "content-type": "application/json", "x-api-key": key },
    });
    expect(type.status).toBe(201);
  });

  test("an invalid key is a hard 401, even on public reads", async () => {
    const res = await req("/api/content/article", {
      headers: { "x-api-key": "ocms_not_a_real_key" },
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  test("key management is admin-only and roles are validated", async () => {
    const editorCookie = await createEditor(ctx);

    const denied = await req(
      "/api/auth/api-key/create",
      json("POST", { name: "sneaky", metadata: { role: "admin" } }, editorCookie)
    );
    expect(denied.status).toBe(403);

    const anonymous = await req(
      "/api/auth/api-key/create",
      json("POST", { name: "drive-by" })
    );
    expect(anonymous.status).toBe(403);

    const badRole = await req(
      "/api/auth/api-key/create",
      json("POST", { name: "weird", metadata: { role: "superuser" } }, ctx.adminCookie)
    );
    expect(badRole.status).toBe(400);
  });

  test("a key without an explicit role defaults to editor", async () => {
    const created = await req(
      "/api/auth/api-key/create",
      json("POST", { name: "default-role" }, ctx.adminCookie)
    );
    expect(created.status).toBe(200);

    const type = await req("/api/content-types", {
      ...json("POST", { name: "page", label: "Page", fields: [] }),
      headers: { "content-type": "application/json", "x-api-key": created.body.key },
    });
    expect(type.status).toBe(403);
  });
});

describe("public reads", () => {
  let draftId: string;
  let publishedId: string;

  beforeEach(async () => {
    const draft = await req(
      "/api/content/article",
      json("POST", { data: { title: "Secret Draft" } }, ctx.adminCookie)
    );
    draftId = draft.body.id;

    const published = await req(
      "/api/content/article",
      json("POST", { status: "published", data: { title: "Public Post" } }, ctx.adminCookie)
    );
    publishedId = published.body.id;
  });

  test("anonymous list only sees published entries", async () => {
    const list = await req("/api/content/article");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(publishedId);
  });

  test("anonymous cannot opt into drafts via query params", async () => {
    const list = await req("/api/content/article?status=draft");
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(0);
  });

  test("anonymous get by id and slug: published ok, drafts 404", async () => {
    expect((await req(`/api/content/article/${publishedId}`)).status).toBe(200);
    expect((await req("/api/content/article/slug/public-post")).status).toBe(200);
    expect((await req(`/api/content/article/${draftId}`)).status).toBe(404);
    expect((await req("/api/content/article/slug/secret-draft")).status).toBe(404);
  });

  test("authenticated readers see drafts", async () => {
    const list = await req("/api/content/article", { headers: { cookie: ctx.adminCookie } });
    expect(list.body.total).toBe(2);
    const draft = await req(`/api/content/article/${draftId}`, {
      headers: { cookie: ctx.adminCookie },
    });
    expect(draft.status).toBe(200);
  });

  test("health stays public", async () => {
    expect((await req("/health")).body.ok).toBe(true);
  });
});
