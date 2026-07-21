/**
 * Local dev server: the self-hosted profile (Bun + SQLite file).
 *
 *   bun run apps/dev/index.ts
 *   curl http://localhost:3000/health
 *
 * Auth lives in the same SQLite file as the content. First signup becomes
 * the admin (POST /api/auth/sign-up/email), then signup closes.
 */
import { Database } from "bun:sqlite";
import { createApp } from "@opencms/api";
import { createAuth, runAuthMigrations, toAuthConnector } from "@opencms/auth";
import { SQLiteDataConnector } from "@opencms/connector-sqlite";

const DB_PATH = "opencms.dev.db";

const data = new SQLiteDataConnector({ path: DB_PATH });
await data.init();

const auth = createAuth({
  database: new Database(DB_PATH),
  // Fine for local dev; anything deployed must set a real secret.
  secret: process.env.BETTER_AUTH_SECRET ?? "opencms-dev-only-secret-never-deploy-me",
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
});
await runAuthMigrations(auth);

const app = createApp({ data, auth: toAuthConnector(auth) });

const server = Bun.serve({ port: 3000, fetch: app.fetch });
console.log(`OpenCMS dev API on http://localhost:${server.port}`);
