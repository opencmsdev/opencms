import { Database } from "bun:sqlite";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { MemoryDataConnector } from "@opencms/core";
import { createAuth, runAuthMigrations, toAuthConnector } from "@opencms/auth";
import { createApp } from "@opencms/api";
import { createMcpApp } from "@opencms/mcp";

export const ADMIN = { email: "admin@opencms.test", password: "admin-password-123", name: "Admin" };
export const EDITOR = { email: "editor@opencms.test", password: "editor-password-123", name: "Editor" };

export const articleType = {
  name: "article",
  label: "Article",
  fields: [
    { name: "title", kind: "text" as const, required: true },
    { name: "views", kind: "number" as const, indexed: true },
  ],
};

export interface TestContext {
  mcp: ReturnType<typeof createMcpApp>;
  api: ReturnType<typeof createApp>;
  adminCookie: string;
}

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const json = (method: string, body: unknown, cookie?: string): RequestInit => ({
  method,
  headers: {
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
  },
  body: JSON.stringify(body),
});

export async function createTestMcp(): Promise<TestContext> {
  const data = new MemoryDataConnector();
  await data.init();

  const auth = createAuth({
    database: new Database(":memory:"),
    secret: "test-secret-not-for-production-0123456789",
    baseURL: "http://localhost",
  });
  await runAuthMigrations(auth);
  const connector = toAuthConnector(auth);

  const api = createApp({ data, auth: connector });
  const mcp = createMcpApp({ data, auth: connector });

  const res = await api.request("/api/auth/sign-up/email", json("POST", ADMIN));
  if (res.status !== 200) {
    throw new Error(`bootstrap signup failed: ${res.status} ${await res.text()}`);
  }
  return { mcp, api, adminCookie: cookieOf(res) };
}

export async function createEditor(ctx: TestContext): Promise<string> {
  const res = await ctx.api.request(
    "/api/auth/admin/create-user",
    json("POST", { ...EDITOR, role: "editor" }, ctx.adminCookie)
  );
  if (res.status !== 200) {
    throw new Error(`create editor failed: ${res.status} ${await res.text()}`);
  }
  const signIn = await ctx.api.request("/api/auth/sign-in/email", json("POST", EDITOR));
  if (signIn.status !== 200) {
    throw new Error(`editor sign-in failed: ${signIn.status} ${await signIn.text()}`);
  }
  return cookieOf(signIn);
}

export async function createApiKey(ctx: TestContext, role: "admin" | "editor"): Promise<string> {
  const res = await ctx.api.request(
    "/api/auth/api-key/create",
    json("POST", { name: `${role}-key`, metadata: { role } }, ctx.adminCookie)
  );
  if (res.status !== 200) {
    throw new Error(`api key create failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { key: string };
  return body.key;
}

export async function connect(
  mcp: TestContext["mcp"],
  headers: Record<string, string> = {}
): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client({ name: "opencms-test", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://opencms.test/mcp"), {
    fetch: async (input, init) => {
      const req = input instanceof Request ? input : new Request(String(input), init);
      return mcp.fetch(req);
    },
    requestInit: { headers },
  });
  await client.connect(transport);
  return { client, transport };
}

export function structured(result: { isError?: boolean; structuredContent?: unknown; content: { type: string; text?: string }[] }): Record<string, unknown> {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent as Record<string, unknown>;
  }
  const text = result.content.find((c) => c.type === "text")?.text;
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}
