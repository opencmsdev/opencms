/**
 * Local dev server: the self-hosted profile (Bun + SQLite file).
 *
 *   bun run apps/dev/index.ts
 *   curl http://localhost:3000/health
 */
import { createApp } from "@opencms/api";
import { SQLiteDataConnector } from "@opencms/connector-sqlite";

const data = new SQLiteDataConnector({ path: "opencms.dev.db" });
await data.init();

const app = createApp({ data });

const server = Bun.serve({ port: 3000, fetch: app.fetch });
console.log(`OpenCMS dev API on http://localhost:${server.port}`);
