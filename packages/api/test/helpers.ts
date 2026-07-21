import { Database } from "bun:sqlite";
import { MemoryDataConnector } from "@opencms/core";
import { createAuth, runAuthMigrations, toAuthConnector, type Auth } from "@opencms/auth";
import { createApp } from "@opencms/api";

/**
 * Test harness: real better-auth on an in-memory bun:sqlite database, the
 * in-memory data connector for content, and the fully wired Hono app.
 * The bootstrap admin is created through the public signup route, exactly
 * like a fresh install.
 */

export const ADMIN = { email: "admin@opencms.test", password: "admin-password-123", name: "Admin" };
export const EDITOR = { email: "editor@opencms.test", password: "editor-password-123", name: "Editor" };

export interface TestContext {
  app: ReturnType<typeof createApp>;
  auth: Auth;
  adminCookie: string;
}

export function cookieOf(res: Response): string {
  const cookies = res.headers.getSetCookie();
  return cookies.map((c) => c.split(";")[0]).join("; ");
}

export const json = (method: string, body: unknown, cookie?: string): RequestInit => ({
  method,
  headers: {
    "content-type": "application/json",
    ...(cookie ? { cookie } : {}),
  },
  body: JSON.stringify(body),
});

export async function createTestApp(): Promise<TestContext> {
  const data = new MemoryDataConnector();
  await data.init();

  const auth = createAuth({
    database: new Database(":memory:"),
    secret: "test-secret-not-for-production-0123456789",
    baseURL: "http://localhost",
  });
  await runAuthMigrations(auth);

  const app = createApp({ data, auth: toAuthConnector(auth) });

  const res = await app.request("/api/auth/sign-up/email", json("POST", ADMIN));
  if (res.status !== 200) {
    throw new Error(`bootstrap signup failed: ${res.status} ${await res.text()}`);
  }
  return { app, auth, adminCookie: cookieOf(res) };
}

/** Sign in an existing user and return their session cookie. */
export async function signIn(
  app: TestContext["app"],
  creds: { email: string; password: string }
): Promise<string> {
  const res = await app.request("/api/auth/sign-in/email", json("POST", creds));
  if (res.status !== 200) {
    throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  }
  return cookieOf(res);
}

/** Have the bootstrap admin create an editor account via the admin plugin. */
export async function createEditor(ctx: TestContext): Promise<string> {
  const res = await ctx.app.request(
    "/api/auth/admin/create-user",
    json("POST", { ...EDITOR, role: "editor" }, ctx.adminCookie)
  );
  if (res.status !== 200) {
    throw new Error(`create editor failed: ${res.status} ${await res.text()}`);
  }
  return signIn(ctx.app, EDITOR);
}

/** Create an API key with the given role, returning the raw key. */
export async function createApiKey(ctx: TestContext, role: "admin" | "editor"): Promise<string> {
  const res = await ctx.app.request(
    "/api/auth/api-key/create",
    json("POST", { name: `${role}-key`, metadata: { role } }, ctx.adminCookie)
  );
  if (res.status !== 200) {
    throw new Error(`api key create failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { key: string };
  return body.key;
}
