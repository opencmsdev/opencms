/**
 * The interactive flow. Everything goes through the IO interface, so tests
 * drive the whole wizard with scripted answers and assert the config out.
 */
import type { IO } from "./io.ts";
import { palette } from "./io.ts";
import { confirm, select, text } from "./prompts.ts";
import {
  bunSqlite,
  cloudflare,
  cloudflareCdn,
  cloudflarePages,
  defineConfig,
  netlify,
  otherCdn,
  otherFrontend,
  parseOriginList,
  r2,
  s3,
  sameOrigin,
  validateBucket,
  validateCloudflareName,
  validateDomain,
  validateEmail,
  validateOriginList,
  validatePort,
  validateTtl,
  validateUrl,
  vercel,
  type BackendConfig,
  type CacheConfig,
  type CacheKind,
  type FrontendConfig,
  type FrontendHost,
  type InitConfig,
  type StorageConfig,
  type StorageKind,
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
    return bunSqlite({
      publicUrl: publicUrl.replace(/\/+$/, ""),
      port: Number(port),
      dbPath,
    });
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
  return cloudflare({
    workerName,
    d1Name,
    ...(customDomain === "" ? {} : { customDomain: customDomain.toLowerCase() }),
  });
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
  if (host === "same-origin") return sameOrigin();

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
  const options = { url, extraOrigins: parseOriginList(extra), credentials };
  switch (host) {
    case "vercel":
      return vercel(options);
    case "netlify":
      return netlify(options);
    case "cloudflare-pages":
      return cloudflarePages(options);
    case "other":
      return otherFrontend(options);
  }
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
  const options = { ttlSeconds: Number(ttl) };
  return kind === "cloudflare-cdn" ? cloudflareCdn(options) : otherCdn(options);
}

async function askStorage(io: IO): Promise<StorageConfig | undefined> {
  const kind = await select<StorageKind | "none">(
    io,
    "Storage (optional): where do uploaded files live?",
    [
      { value: "none", label: "None", hint: "in-memory locally, or skip the media library" },
      { value: "s3", label: "S3-compatible", hint: "AWS, MinIO, Tigris, ..." },
      { value: "r2", label: "Cloudflare R2", hint: "opencms setup will create the bucket" },
    ],
    { defaultValue: "none" },
  );
  if (kind === "none") return undefined;
  const bucket = await text(io, "Bucket name", {
    defaultValue: kind === "r2" ? "opencms-media" : undefined,
    required: true,
    validate: validateBucket,
  });
  const publicBaseUrl = await text(io, "Public base URL for files, e.g. https://media.example.com", {
    validate: validateUrl,
  });
  if (kind === "r2") {
    return r2({
      bucket,
      ...(publicBaseUrl === "" ? {} : { publicBaseUrl }),
    });
  }
  const endpoint = await text(io, "S3 endpoint URL (skip for AWS)", { validate: validateUrl });
  const region = await text(io, "S3 region", { defaultValue: "auto" });
  return s3({
    bucket,
    ...(endpoint === "" ? {} : { endpoint }),
    ...(region === "" ? {} : { region }),
    ...(publicBaseUrl === "" ? {} : { publicBaseUrl }),
  });
}

/** Runs the full wizard. Returns null when the user declines the summary. */
export async function runWizard(io: IO): Promise<InitConfig | null> {
  const c = palette(io.colorEnabled);
  io.write(`\n${c.bold("OpenCMS init")}\n`);
  io.write(
    c.dim(
      "A few questions, then this writes opencms.config.ts. Run `opencms setup`\nin the project folder to create the resources those integrations need.\n",
    ),
  );

  const projectName = await text(io, "Project name", { defaultValue: "my-site", required: true });
  const backend = await askBackend(io);
  const frontend = await askFrontend(io);
  const cache = await askCache(io);
  const storage = await askStorage(io);
  const adminEmail = await text(io, "Admin email (the first signup becomes the admin)", {
    required: true,
    validate: validateEmail,
  });
  const adminName = await text(io, "Admin display name", {
    defaultValue: "Admin",
    required: true,
  });

  const config = defineConfig({ projectName, adminEmail, adminName, backend, frontend, cache, storage });

  io.write(`\n${c.bold("Summary")}\n`);
  for (const row of summaryRows(config)) {
    io.write(`  ${c.dim(`${row.label}:`)} ${row.value}\n`);
  }

  const ok = await confirm(io, "Generate the agent prompt with these settings?", true);
  return ok ? config : null;
}
