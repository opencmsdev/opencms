import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  articleType,
  connect,
  createApiKey,
  createEditor,
  createTestMcp,
  structured,
  type TestContext,
} from "./helpers.ts";

let ctx: TestContext;
const sessions: { client: Client; transport: StreamableHTTPClientTransport }[] = [];

async function mcp(headers: Record<string, string> = {}) {
  const session = await connect(ctx.mcp, headers);
  sessions.push(session);
  return session.client;
}

beforeEach(async () => {
  ctx = await createTestMcp();
  await ctx.api.request("/api/content-types", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: ctx.adminCookie },
    body: JSON.stringify(articleType),
  });
});

afterEach(async () => {
  while (sessions.length > 0) {
    const session = sessions.pop();
    if (!session) break;
    await session.client.close().catch(() => undefined);
  }
});

describe("health and handshake", () => {
  test("GET /health reports opencms-mcp", async () => {
    const res = await ctx.mcp.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; name: string };
    expect(body.ok).toBe(true);
    expect(body.name).toBe("opencms-mcp");
  });

  test("invalid API key is HTTP 401", async () => {
    const res = await ctx.mcp.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": "ocms_nope" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(res.status).toBe(401);
  });

  test("lists the content tools", async () => {
    const client = await mcp();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "create_content_type",
      "create_entry",
      "delete_content_type",
      "delete_entry",
      "get_content_type",
      "get_entry",
      "get_entry_by_slug",
      "list_content_types",
      "list_entries",
      "publish_entry",
      "unpublish_entry",
      "update_content_type",
      "update_entry",
    ]);
  });
});

describe("RBAC", () => {
  test("anonymous reads published entries only", async () => {
    const admin = await createApiKey(ctx, "admin");
    const editorClient = await mcp({ "x-api-key": admin });
    const created = await editorClient.callTool({
      name: "create_entry",
      arguments: { type: "article", data: { title: "Draft" } },
    });
    expect(created.isError).toBeFalsy();
    const published = await editorClient.callTool({
      name: "create_entry",
      arguments: { type: "article", status: "published", data: { title: "Live" } },
    });
    expect(published.isError).toBeFalsy();

    const anon = await mcp();
    const listed = await anon.callTool({ name: "list_entries", arguments: { type: "article" } });
    expect(listed.isError).toBeFalsy();
    const items = structured(listed).items as { slug: string }[];
    expect(items.map((e) => e.slug)).toEqual(["live"]);

    const draftId = structured(created).id as string;
    const hidden = await anon.callTool({ name: "get_entry", arguments: { type: "article", id: draftId } });
    expect(hidden.isError).toBe(true);
    expect(structured(hidden).error).toBe("not_found");

    const schema = await anon.callTool({ name: "list_content_types", arguments: {} });
    expect(schema.isError).toBe(true);
    expect(structured(schema).error).toBe("unauthorized");
  });

  test("editors manage content but not schema", async () => {
    const key = await createApiKey(ctx, "editor");
    const client = await mcp({ "x-api-key": key });

    const created = await client.callTool({
      name: "create_entry",
      arguments: { type: "article", data: { title: "By Editor" } },
    });
    expect(created.isError).toBeFalsy();

    const denied = await client.callTool({
      name: "create_content_type",
      arguments: { name: "page", label: "Page", fields: [] },
    });
    expect(denied.isError).toBe(true);
    expect(structured(denied).error).toBe("forbidden");
  });

  test("Authorization Bearer is accepted", async () => {
    const key = await createApiKey(ctx, "admin");
    const client = await mcp({ authorization: `Bearer ${key}` });
    const listed = await client.callTool({ name: "list_content_types", arguments: {} });
    expect(listed.isError).toBeFalsy();
    const items = structured(listed).items as { name: string }[];
    expect(items.map((t) => t.name)).toEqual(["article"]);
  });

  test("session cookie still works when posted at the MCP host", async () => {
    const client = await mcp({ cookie: ctx.adminCookie });
    const listed = await client.callTool({ name: "list_content_types", arguments: {} });
    expect(listed.isError).toBeFalsy();
  });
});

describe("content lifecycle", () => {
  test("admin creates, updates, publishes, unpublishes, deletes", async () => {
    const key = await createApiKey(ctx, "admin");
    const client = await mcp({ "x-api-key": key });

    const created = await client.callTool({
      name: "create_entry",
      arguments: { type: "article", data: { title: "Hello World", views: 1 } },
    });
    expect(created.isError).toBeFalsy();
    const id = structured(created).id as string;
    expect(structured(created).slug).toBe("hello-world");

    const bySlug = await client.callTool({
      name: "get_entry_by_slug",
      arguments: { type: "article", slug: "hello-world" },
    });
    expect(structured(bySlug).id).toBe(id);

    const patched = await client.callTool({
      name: "update_entry",
      arguments: { type: "article", id, data: { views: 2 } },
    });
    expect((structured(patched).data as { views: number }).views).toBe(2);

    const published = await client.callTool({ name: "publish_entry", arguments: { type: "article", id } });
    expect(structured(published).status).toBe("published");

    const unpublished = await client.callTool({
      name: "unpublish_entry",
      arguments: { type: "article", id },
    });
    expect(structured(unpublished).status).toBe("draft");

    const deleted = await client.callTool({ name: "delete_entry", arguments: { type: "article", id } });
    expect(structured(deleted).ok).toBe(true);

    const missing = await client.callTool({ name: "get_entry", arguments: { type: "article", id } });
    expect(missing.isError).toBe(true);
  });

  test("admin updates and deletes a content type", async () => {
    const key = await createApiKey(ctx, "admin");
    const client = await mcp({ "x-api-key": key });

    const updated = await client.callTool({
      name: "update_content_type",
      arguments: { ...articleType, label: "Articles" },
    });
    expect(structured(updated).label).toBe("Articles");

    const deleted = await client.callTool({
      name: "delete_content_type",
      arguments: { name: "article" },
    });
    expect(structured(deleted).ok).toBe(true);
  });
});

describe("CORS", () => {
  test("preflight allows MCP protocol headers", async () => {
    const res = await ctx.mcp.request("/mcp", {
      method: "OPTIONS",
      headers: {
        origin: "https://inspector.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,mcp-protocol-version,mcp-session-id",
      },
    });
    expect(res.status).toBe(204);
    const allow = res.headers.get("access-control-allow-headers") ?? "";
    expect(allow).toContain("authorization");
    expect(allow).toContain("mcp-protocol-version");
    expect(allow).toContain("mcp-session-id");
  });
});

describe("editor helper still works for cookies", () => {
  test("createEditor returns a session that can write content", async () => {
    const cookie = await createEditor(ctx);
    const client = await mcp({ cookie });
    const created = await client.callTool({
      name: "create_entry",
      arguments: { type: "article", data: { title: "Cookie Editor" } },
    });
    expect(created.isError).toBeFalsy();
  });
});
