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
import { PostgresDataConnector } from "@opencms/connector-postgres";
import { SQLiteDataConnector } from "@opencms/connector-sqlite";
import { S3StorageConnector } from "@opencms/connector-s3";
import { MemoryCacheConnector, MemoryStorageConnector, type StorageConnector } from "@opencms/core";

const DB_PATH = process.env.OPENCMS_DB ?? "opencms.dev.db";
const PORT = Number(process.env.OPENCMS_PORT ?? 3000);
const ADMIN_DIST = new URL("../admin/dist/", import.meta.url).pathname;

/**
 * Content storage: Postgres when OPENCMS_PG_URL is set (Supabase, Neon and
 * plain Postgres connection strings all work), the SQLite file otherwise.
 * Auth stays in the local SQLite file either way for now; moving it into
 * Postgres is tracked separately.
 */
const data = process.env.OPENCMS_PG_URL
  ? new PostgresDataConnector({ url: process.env.OPENCMS_PG_URL })
  : new SQLiteDataConnector({ path: DB_PATH });
await data.init();

// The dev fallback secret is fine on a laptop and catastrophic deployed.
// Production (the Docker image sets NODE_ENV) refuses to boot without one.
if (!process.env.BETTER_AUTH_SECRET && process.env.NODE_ENV === "production") {
  console.error(
    "refusing to start: set BETTER_AUTH_SECRET (e.g. `openssl rand -hex 32`)"
  );
  process.exit(1);
}

const auth = createAuth({
  database: new Database(DB_PATH),
  // Fine for local dev; anything deployed must set a real secret.
  secret: process.env.BETTER_AUTH_SECRET ?? "opencms-dev-only-secret-never-deploy-me",
  baseURL: process.env.BETTER_AUTH_URL ?? `http://localhost:${PORT}`,
});
await runAuthMigrations(auth);

/**
 * Media storage: any S3-compatible bucket via OPENCMS_S3_* env, otherwise an
 * in-memory store so the media library works out of the box. The in-memory
 * fallback loses uploads on restart; point it at a real bucket to keep them.
 */
function storageFromEnv(): StorageConnector {
  const env = process.env;
  if (env.OPENCMS_S3_BUCKET) {
    return new S3StorageConnector({
      bucket: env.OPENCMS_S3_BUCKET,
      endpoint: env.OPENCMS_S3_ENDPOINT,
      accountId: env.OPENCMS_S3_ACCOUNT_ID,
      region: env.OPENCMS_S3_REGION,
      accessKeyId: env.OPENCMS_S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.OPENCMS_S3_SECRET_ACCESS_KEY ?? "",
      publicBaseUrl: env.OPENCMS_S3_PUBLIC_BASE_URL,
    });
  }
  console.warn(
    "media: no OPENCMS_S3_BUCKET set, uploads are stored in memory and lost on restart"
  );
  return new MemoryStorageConnector();
}

/**
 * Anonymous read cache: OPENCMS_CACHE=memory turns on an in-process cache for
 * published reads (OPENCMS_CACHE_TTL seconds, default 60). Off by default so
 * local editing always reads its own writes instantly.
 */
const cache =
  process.env.OPENCMS_CACHE === "memory"
    ? {
        connector: new MemoryCacheConnector(),
        ttlSeconds: Number(process.env.OPENCMS_CACHE_TTL ?? "") || undefined,
      }
    : undefined;

const app = createApp({ data, auth: toAuthConnector(auth), storage: storageFromEnv(), cache });

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
