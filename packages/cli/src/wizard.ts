/**
 * The interactive flow. Everything goes through the IO interface, so tests
 * drive the whole wizard with scripted answers and assert the config out.
 */
import type { IO } from "./io.ts";
import { palette } from "./io.ts";
import { confirm, select, text } from "./prompts.ts";
import type {
  BackendConfig,
  CacheConfig,
  CacheKind,
  FrontendConfig,
  FrontendHost,
  InitConfig,
} from "./config.ts";
import {
  parseOriginList,
  validateCloudflareName,
  validateDomain,
  validateEmail,
  validateOriginList,
  validatePort,
  validateTtl,
  validateUrl,
} from "./config.ts";
import { summaryRows } from "./render.ts";

function defaultPortFor(publicUrl: string): string {
  const port = new URL(publicUrl).port;
  return port === "" ? "3000" : port;
}

async function askBackend(io: IO): Promise<BackendConfig> {
  const kind = await select(io, "Backend (required): where does the OpenCMS API run?", [
    { value: "bun-sqlite", label: "Self-hosted: Bun + SQLite", hint: "one process, one file database" },
    { value: "cloudflare", label: "Cloudflare Workers + D1", hint: "serverless, at the edge" },
  ] as const);

  if (kind === "bun-sqlite") {
    const publicUrl = await text(io, "Public URL the API will be reached at", {
      defaultValue: "http://localhost:3000",
      required: true,
      validate: validateUrl,
    });
    const port = await text(io, "Port the server listens on", {
      defaultValue: defaultPortFor(publicUrl),
      required: true,
      validate: validatePort,
    });
    const dbPath = await text(io, "SQLite database file", {
      defaultValue: "opencms.db",
      required: true,
    });
    return { kind, publicUrl: publicUrl.replace(/\/+$/, ""), port: Number(port), dbPath };
  }

  const workerName = await text(io, "Worker name", {
    defaultValue: "opencms-api",
    required: true,
    validate: validateCloudflareName,
  });
  const d1Name = await text(io, "D1 database name", {
    defaultValue: "opencms",
    required: true,
    validate: validateCloudflareName,
  });
  const customDomain = await text(io, "Custom domain, e.g. cms.example.com", {
    validate: validateDomain,
  });
  return customDomain === ""
    ? { kind, workerName, d1Name }
    : { kind, workerName, d1Name, customDomain: customDomain.toLowerCase() };
}

async function askFrontend(io: IO): Promise<FrontendConfig | undefined> {
  const host = await select<FrontendHost | "none">(
    io,
    "Frontend host (optional): where does the site that consumes the API live?",
    [
      { value: "none", label: "None / skip", hint: "API only for now" },
      { value: "vercel", label: "Vercel" },
      { value: "netlify", label: "Netlify" },
      { value: "cloudflare-pages", label: "Cloudflare Pages / Workers" },
      { value: "same-origin", label: "Same origin as the API", hint: "no CORS needed" },
      { value: "other", label: "Other" },
    ],
    { defaultValue: "none" },
  );
  if (host === "none") return undefined;
  if (host === "same-origin") return { host, extraOrigins: [], credentials: false };

  const url = await text(io, "Frontend production URL", {
    required: true,
    validate: validateUrl,
  });
  const extra = await text(
    io,
    "Extra allowed origins, comma separated (preview URLs, http://localhost:5173, ...)",
    { validate: validateOriginList },
  );
  const credentials = await confirm(
    io,
    "Will the frontend sign users in with cookies (cross-origin credentials)?",
    false,
  );
  return { host, url, extraOrigins: parseOriginList(extra), credentials };
}

async function askCache(io: IO): Promise<CacheConfig | undefined> {
  const kind = await select<CacheKind | "none">(
    io,
    "Cache (optional): CDN caching for published content?",
    [
      { value: "none", label: "None", hint: "every read hits the API" },
      { value: "cloudflare-cdn", label: "Cloudflare CDN in front of the API" },
      { value: "other-cdn", label: "Another CDN", hint: "Fastly, CloudFront, ..." },
    ],
    { defaultValue: "none" },
  );
  if (kind === "none") return undefined;
  const ttl = await text(io, "Cache TTL for published content, in seconds", {
    defaultValue: "60",
    required: true,
    validate: validateTtl,
  });
  return { kind, ttlSeconds: Number(ttl) };
}

/** Runs the full wizard. Returns null when the user declines the summary. */
export async function runWizard(io: IO): Promise<InitConfig | null> {
  const c = palette(io.colorEnabled);
  io.write(`\n${c.bold("OpenCMS init")}\n`);
  io.write(
    c.dim(
      "A few questions, then this prints a ready-to-run prompt for your coding\nagent. Nothing is installed or deployed by the wizard itself.\n",
    ),
  );

  const projectName = await text(io, "Project name", { defaultValue: "my-site", required: true });
  const backend = await askBackend(io);
  const frontend = await askFrontend(io);
  const cache = await askCache(io);
  const adminEmail = await text(io, "Admin email (the first signup becomes the admin)", {
    required: true,
    validate: validateEmail,
  });
  const adminName = await text(io, "Admin display name", {
    defaultValue: "Admin",
    required: true,
  });

  const config: InitConfig = { projectName, adminEmail, adminName, backend, frontend, cache };

  io.write(`\n${c.bold("Summary")}\n`);
  for (const row of summaryRows(config)) {
    io.write(`  ${c.dim(`${row.label}:`)} ${row.value}\n`);
  }

  const ok = await confirm(io, "Generate the agent prompt with these settings?", true);
  return ok ? config : null;
}
