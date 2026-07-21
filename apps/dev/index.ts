/**
 * Local dev server: the self-hosted profile (Bun + SQLite file).
 *
 *   bun run apps/dev/index.ts
 *   curl http://localhost:3000/health
 *
 * Auth lives in the same SQLite file as the content. First signup becomes
 * the admin (or use the admin UI's first-run screen), then signup closes.
 *
 * If apps/admin has been built (bun run --cwd apps/admin build), this server
 * also serves the admin SPA on every non-API route. During UI development,
 * `vite` in apps/admin proxies API calls here instead.
 *
 * Env: OPENCMS_DB (SQLite path), OPENCMS_PORT, BETTER_AUTH_SECRET.
 */
import { Database } from "bun:sqlite";
import { createApp } from "@opencms/api";
import { createAuth, runAuthMigrations, toAuthConnector } from "@opencms/auth";
import { SQLiteDataConnector } from "@opencms/connector-sqlite";

const DB_PATH = process.env.OPENCMS_DB ?? "opencms.dev.db";
const PORT = Number(process.env.OPENCMS_PORT ?? 3000);
const ADMIN_DIST = new URL("../admin/dist/", import.meta.url).pathname;

const data = new SQLiteDataConnector({ path: DB_PATH });
await data.init();

const auth = createAuth({
  database: new Database(DB_PATH),
  // Fine for local dev; anything deployed must set a real secret.
  secret: process.env.BETTER_AUTH_SECRET ?? "opencms-dev-only-secret-never-deploy-me",
  baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${PORT}`,
});
await runAuthMigrations(auth);

const app = createApp({ data, auth: toAuthConnector(auth) });

/** Serve the built admin SPA for non-API GETs; null when not applicable. */
async function serveAdmin(req: Request): Promise<Response | null> {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const { pathname } = new URL(req.url);
  if (pathname.startsWith("/api/") || pathname === "/api" || pathname === "/health") return null;
  if (pathname.includes("..")) return null;

  const candidate = pathname === "/" ? "index.html" : pathname.slice(1);
  let file = Bun.file(ADMIN_DIST + candidate);
  if (!(await file.exists())) file = Bun.file(ADMIN_DIST + "index.html"); // SPA fallback
  if (!(await file.exists())) return null; // admin not built; API-only mode
  return new Response(file);
}

const server = Bun.serve({
  port: PORT,
  fetch: async (req) => (await serveAdmin(req)) ?? app.fetch(req),
});
console.log(`OpenCMS dev API on http://localhost:${server.port}`);
