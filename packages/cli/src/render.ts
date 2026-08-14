/**
 * Renders the collected configuration into the deliverable: a self-contained
 * markdown prompt a coding agent can execute. Commands and file paths here
 * must stay in sync with docs/QUICKSTART.md, docs/DEPLOY_CLOUDFLARE.md and
 * docs/CORS.md; the generated prompt points the agent at those docs too.
 *
 * Two variants: the default assumes the agent starts from nothing (clone
 * included); `scaffolded` assumes `opencms init` already cloned the repo and
 * materialized the choices (opencms.config.ts, .env or wrangler.toml), so
 * the prompt starts from that folder and never regenerates its secrets.
 *
 * The wizard collects no secrets, and no secret ever appears in the prompt.
 */
import type { InitConfig } from "./config.ts";
import { apiBaseUrl, corsOrigins } from "./config.ts";
import { projectDirName } from "./scaffold.ts";

const FRONTEND_HOST_LABELS: Record<string, string> = {
  vercel: "Vercel",
  netlify: "Netlify",
  "cloudflare-pages": "Cloudflare Pages / Workers",
  "same-origin": "Same origin as the API",
  other: "Other",
};

export interface SummaryRow {
  label: string;
  value: string;
}

/** One row per decision; shown in the terminal summary and the prompt table. */
export function summaryRows(config: InitConfig): SummaryRow[] {
  const rows: SummaryRow[] = [{ label: "Project", value: config.projectName }];
  const backend = config.backend;
  if (backend.kind === "bun-sqlite") {
    rows.push(
      { label: "Backend", value: "Self-hosted: Bun + SQLite" },
      { label: "API URL", value: backend.publicUrl },
      { label: "Port", value: String(backend.port) },
      { label: "SQLite file", value: backend.dbPath },
    );
  } else {
    rows.push(
      { label: "Backend", value: "Cloudflare Workers + D1" },
      { label: "Worker name", value: backend.workerName },
      { label: "D1 database", value: backend.d1Name },
      { label: "Domain", value: backend.customDomain ?? "workers.dev (assigned at deploy)" },
    );
  }

  const frontend = config.frontend;
  if (!frontend) {
    rows.push({ label: "Frontend host", value: "None (API only)" });
  } else {
    const label = FRONTEND_HOST_LABELS[frontend.host] ?? frontend.host;
    rows.push({ label: "Frontend host", value: frontend.url ? `${label} (${frontend.url})` : label });
    const origins = corsOrigins(config);
    if (origins.length > 0) {
      rows.push({ label: "Allowed origins", value: origins.join(", ") });
      rows.push({ label: "Cookie auth from frontend", value: frontend.credentials ? "yes" : "no" });
    }
  }

  const cache = config.cache;
  rows.push({
    label: "Cache",
    value: cache
      ? `${cache.kind === "cloudflare-cdn" ? "Cloudflare CDN" : "CDN"}, TTL ${cache.ttlSeconds}s`
      : "None",
  });
  const storage = config.storage;
  if (!storage) {
    rows.push({ label: "Storage", value: "None" });
  } else if (storage.kind === "r2") {
    rows.push({ label: "Storage", value: `Cloudflare R2 (${storage.bucket})` });
  } else {
    rows.push({
      label: "Storage",
      value: `S3 (${storage.bucket}${storage.endpoint ? `, ${storage.endpoint}` : ""})`,
    });
  }
  rows.push({ label: "Admin account", value: `${config.adminName} <${config.adminEmail}>` });
  return rows;
}

export function renderAgentPrompt(
  config: InitConfig,
  opts: { scaffolded?: boolean } = {},
): string {
  const scaffolded = opts.scaffolded ?? false;
  const dir = projectDirName(config.projectName);
  const backend = config.backend;
  const api = apiBaseUrl(backend);
  const origins = corsOrigins(config);
  const cache = config.cache;
  const lines: string[] = [];
  let step = 0;
  const heading = (title: string) => {
    step += 1;
    lines.push(`### Step ${step}: ${title}`, "");
  };

  lines.push(
    `# Agent task: set up OpenCMS for "${config.projectName}"`,
    "",
    "You are a coding agent with shell access. Set up a working OpenCMS instance",
    "using the configuration below. Follow the steps in order, verify each step",
    "before moving on, and finish by walking the acceptance checklist.",
    "",
    "## What OpenCMS is",
    "",
    "- Open source headless CMS: https://github.com/opencmsdev/opencms",
    "- Content types are data, not code: created from the admin UI or API, no",
    "  migrations, no restarts.",
    "- Auth is better-auth mounted at `/api/auth/*` in the same app and database.",
    "  The FIRST account to sign up becomes the admin and public signup then",
    "  closes permanently, so bootstrap the admin as soon as the instance is up.",
    "- Published entries are readable anonymously; drafts are invisible without",
    "  auth (404 by id and by slug).",
    "- Docs in the repo: `docs/QUICKSTART.md`, `docs/DEPLOY_CLOUDFLARE.md`,",
    "  `docs/CORS.md`, `docs/MCP.md`.",
    "",
    "## Target configuration",
    "",
    "| Setting | Value |",
    "|---|---|",
    ...summaryRows(config).map((row) => `| ${row.label} | ${row.value} |`),
    ...(scaffolded ? [`| Local folder | ./${dir} (already cloned and configured) |`] : []),
    "",
    "## Steps",
    "",
  );

  if (scaffolded) {
    heading("Enter the project and install");
    lines.push(
      "`opencms init` already cloned the repository and wrote the configuration:",
      "`opencms.config.ts` records the choices above" +
        (backend.kind === "bun-sqlite"
          ? ", and `.env` carries the runtime settings, including a generated `BETTER_AUTH_SECRET`. Do not regenerate or print it, and never commit `.env`."
          : ", and `apps/worker/wrangler.toml` already carries the worker name and D1 database name."),
      "",
      "```bash",
      `cd ${dir}`,
      "bun install",
      "bunx opencms setup",
      "```",
      "",
      "`opencms setup` creates D1 / R2, writes secrets, and asks for S3 keys when",
      "those integrations are in `opencms.config.ts`. It is safe to re-run.",
      "",
      "Requires Bun 1.2 or newer (https://bun.sh).",
      "",
    );
  } else {
    heading("Get the code and install");
    lines.push(
      "Requires Bun 1.2 or newer (https://bun.sh).",
      "",
      "```bash",
      "git clone https://github.com/opencmsdev/opencms.git",
      "cd opencms",
      "bun install",
      "```",
      "",
      "If `opencms.config.ts` is present, run `bunx opencms setup` next so D1,",
      "secrets and S3/R2 are created from that file instead of by hand.",
      "",
    );
  }

  if (backend.kind === "bun-sqlite") {
    heading("Build the admin UI");
    lines.push(
      "```bash",
      "bun run build:admin",
      "```",
      "",
      "Without this the server runs API-only with no admin UI.",
      "",
    );

    if (scaffolded) {
      heading("Start the server");
      lines.push(
        "The `.env` file already sets `OPENCMS_DB`, `OPENCMS_PORT` and",
        "`BETTER_AUTH_SECRET`, and Bun loads it automatically:",
        "",
        "```bash",
        "bun run dev",
        "```",
        "",
        `The server prints \`OpenCMS dev API on http://localhost:${backend.port}\`.`,
        "",
      );
    } else {
      heading("Configure and start the server");
      lines.push(
        "Generate the auth secret at setup time. Never hardcode it, never commit",
        "it, and store it only in the environment (or the host's secret store).",
        "",
        "```bash",
        'export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"',
        `export OPENCMS_DB="${backend.dbPath}"`,
        `export OPENCMS_PORT=${backend.port}`,
        "bun run dev",
        "```",
        "",
        `The server prints \`OpenCMS dev API on http://localhost:${backend.port}\`.`,
        "",
      );
    }

    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(backend.publicUrl);
    if (!isLocal) {
      heading("Expose it at the public URL");
      lines.push(
        `This instance must be reachable at ${backend.publicUrl}. Put a reverse`,
        `proxy (Caddy, nginx) in front of port ${backend.port} and terminate TLS`,
        "there. Also set the canonical URL so auth cookies and origin checks use",
        "it:",
        "",
        ...(scaffolded
          ? [`\`.env\` already sets \`BETTER_AUTH_URL=${backend.publicUrl}\`.`]
          : ["```bash", `export BETTER_AUTH_URL="${backend.publicUrl}"`, "```"]),
        "",
        "Run the process under a supervisor (systemd, a container, or similar) so",
        "it restarts on failure and on boot.",
        "",
      );
    }
  } else {
    heading("Provision Cloudflare resources");
    lines.push(
      "From the project root:",
      "",
      "```bash",
      "bunx opencms setup",
      "```",
      "",
      "This logs into Cloudflare if needed, creates the D1 database",
      `\`${backend.d1Name}\`, writes \`database_id\` into \`apps/worker/wrangler.toml\`,`,
      "and stores `BETTER_AUTH_SECRET`.",
      ...(backend.customDomain
        ? [`It also attaches \`${backend.customDomain}\` as a custom domain.`]
        : []),
      "R2 buckets and S3 keys are created or stored when those integrations are",
      "in `opencms.config.ts`. Safe to re-run. No migration step exists or is",
      "needed: the Worker creates the content and auth tables on first request.",
      "",
    );

    heading("Build the admin UI and deploy");
    lines.push(
      "```bash",
      "bun run build:admin",
      "cd apps/worker && bunx wrangler deploy",
      "```",
      "",
      backend.customDomain
        ? `The Worker serves https://${backend.customDomain} once the zone is on this account.`
        : `Wrangler prints the deployed URL. Wherever this prompt says \`${api}\`,`,
      ...(backend.customDomain ? [] : ["substitute that real URL."]),
      "",
    );
  }

  if (origins.length > 0) {
    heading("CORS for the frontend");
    const entryFile =
      backend.kind === "bun-sqlite" ? "apps/dev/index.ts" : "apps/worker/src/index.ts";
    const originList = origins.map((origin) => `"${origin}"`).join(", ");
    lines.push(
      `The frontend is served from a different origin than the API, so allow it`,
      `explicitly. In \`${entryFile}\`, pass a \`cors\` option to \`createApp\`:`,
      "",
      "```ts",
      "const app = createApp({",
      "  // ...existing options,",
      "  cors: {",
      `    origin: [${originList}],`,
      `    credentials: ${config.frontend?.credentials ?? false},`,
      "  },",
      "});",
      "```",
      "",
    );
    if (config.frontend?.credentials) {
      lines.push(
        "Cookie auth across origins also requires the same origins to be passed as",
        "`trustedOrigins` to `createAuth({ ... })` in the same file: better-auth",
        "runs its own CSRF check on `/api/auth/*` and rejects the request before",
        "CORS is even consulted. Both halves are documented in `docs/CORS.md`.",
        "",
      );
    } else {
      lines.push(
        "The frontend reads content anonymously, so no `trustedOrigins` change is",
        "needed. Details in `docs/CORS.md`.",
        "",
      );
    }
  } else {
    heading("CORS");
    lines.push(
      config.frontend?.host === "same-origin"
        ? "The frontend shares the API origin, so no CORS configuration is needed."
        : "No separate frontend is configured. The default permissive CORS",
      ...(config.frontend?.host === "same-origin"
        ? []
        : [
            "(`Access-Control-Allow-Origin: *`, credentials off) is safe to keep: it",
            "exposes published content only, which is already public.",
          ]),
      "",
    );
  }

  if (cache) {
    heading("CDN cache for published content");
    lines.push(
      `Put ${cache.kind === "cloudflare-cdn" ? "Cloudflare" : "the CDN"} in front of the API and cache anonymous reads only:`,
      "",
      `- Cache \`GET /api/content/*\` responses for ${cache.ttlSeconds} seconds.`,
      "- Only cache requests that carry no `x-api-key` header and no cookies;",
      "  authenticated reads must always reach the origin.",
      "- Never cache `/api/auth/*` or any non-GET request.",
      `- Published edits can be stale for up to ${cache.ttlSeconds} seconds; purge`,
      "  the cache on publish if the project cannot tolerate that.",
      "",
    );
    if (cache.kind === "cloudflare-cdn") {
      lines.push(
        backend.kind === "cloudflare"
          ? "Implement this as a Cache Rule on the zone in front of the Worker (a custom domain on the zone is required; workers.dev is not cacheable this way)."
          : "Proxy the API hostname through Cloudflare (orange cloud) and add a Cache Rule matching `/api/content/*` with the TTL above.",
        "",
      );
    }
  }

  heading("Bootstrap the admin account");
  lines.push(
    `Open ${api} in a browser: on a fresh database the admin UI shows a`,
    "first-run setup screen. Or bootstrap over HTTP:",
    "",
    "```bash",
    `curl -X POST ${api}/api/auth/sign-up/email \\`,
    "  -H 'content-type: application/json' \\",
    `  -d '{"email":"${config.adminEmail}","password":"<GENERATED-PASSWORD>","name":"${config.adminName}"}'`,
    "```",
    "",
    "Generate a strong random password for `<GENERATED-PASSWORD>` (for example",
    "`openssl rand -base64 24`). Do not write it into any file that could be",
    "committed; deliver it to the user at the end, and recommend they change it.",
    "",
  );

  heading("Verify");
  lines.push(
    "```bash",
    `API=${api}`,
    "",
    "curl $API/health",
    "```",
    "",
    "Then, signed in as the admin (UI or API):",
    "",
    "1. Create a content type `article` with fields `title` (text, required)",
    "   and `body` (richtext).",
    "2. Create one entry and publish it.",
    "3. Confirm it reads back with no credentials:",
    "",
    "```bash",
    'curl "$API/api/content/article"',
    "```",
    "",
    "If machine clients will write content, mint an API key in the admin under",
    "API keys (role `editor`) and verify a write with the `x-api-key` header.",
    "",
    "## Acceptance checklist",
    "",
    "- [ ] `GET /health` returns 200.",
    `- [ ] Admin account exists for ${config.adminEmail}; a second public signup`,
    "      attempt is rejected.",
    "- [ ] A published entry is readable anonymously at `/api/content/article`.",
    "- [ ] A draft entry is not readable anonymously (404 by id and by slug).",
  );
  if (origins.length > 0) {
    lines.push(
      `- [ ] A browser \`fetch\` from ${origins[0]} succeeds against the API.`,
    );
  }
  if (cache) {
    lines.push(
      "- [ ] A repeated anonymous `GET /api/content/article` is served from the",
      "      cache within the TTL, and a request with `x-api-key` bypasses it.",
    );
  }
  lines.push(
    scaffolded && backend.kind === "bun-sqlite"
      ? "- [ ] `BETTER_AUTH_SECRET` lives only in the untracked `.env` (or a secret"
      : "- [ ] `BETTER_AUTH_SECRET` is a generated random value, present only in the",
    scaffolded && backend.kind === "bun-sqlite"
      ? "      store) and is absent from git."
      : "      environment or secret store, and absent from git.",
    "",
    "## Report back",
    "",
    "When done, report: the admin URL, the API base URL, how the admin password",
    "was delivered, and any deviation from this plan.",
    "",
  );

  return lines.join("\n");
}
