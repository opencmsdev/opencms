/**
 * The wizard's output model, the typed integrations written into
 * `opencms.config.ts`, and the validators the prompts use.
 *
 * Integrations are factory functions, the same shape as better-auth plugins
 * (`admin()`, `apiKey()`): callers write `bunSqlite({ ... })`, never
 * `kind: "bun-sqlite"`. Each factory returns an object that owns its own
 * `plan` / `setup` / `test` (and optionally `nextSteps`). `opencms setup`
 * just walks those methods. Discriminators stay on the objects so the rest
 * of the CLI can narrow them.
 *
 * The two backend integrations mirror the two profiles the repo ships:
 * apps/dev (Bun + SQLite) and apps/worker (Cloudflare Workers + D1).
 */

import type { Integration } from "./setup-context.ts";

export type { BunSqliteOptions } from "./integrations/bun-sqlite.ts";
export type { CloudflareOptions } from "./integrations/cloudflare.ts";
export type { CdnOptions } from "./integrations/cdn.ts";
export type { S3Options } from "./integrations/s3.ts";
export type { R2Options } from "./integrations/r2.ts";
export { bunSqlite } from "./integrations/bun-sqlite.ts";
export { cloudflare } from "./integrations/cloudflare.ts";
export { cloudflareCdn, otherCdn } from "./integrations/cdn.ts";
export { r2 } from "./integrations/r2.ts";
export { s3 } from "./integrations/s3.ts";

export type BackendKind = "bun-sqlite" | "cloudflare";

export interface SelfHostedBackend extends Integration {
  kind: "bun-sqlite";
  /** Canonical URL the API is reached at, e.g. http://localhost:3000. */
  publicUrl: string;
  port: number;
  dbPath: string;
}

export interface CloudflareBackend extends Integration {
  kind: "cloudflare";
  workerName: string;
  d1Name: string;
  /** Bare hostname, e.g. cms.example.com. Absent = *.workers.dev. */
  customDomain?: string;
}

export type BackendConfig = SelfHostedBackend | CloudflareBackend;

export type FrontendHost = "vercel" | "netlify" | "cloudflare-pages" | "same-origin" | "other";

export interface FrontendConfig {
  host: FrontendHost;
  /** Production URL. Absent only for same-origin, which needs no CORS. */
  url?: string;
  /** Additional allowed origins (previews, localhost dev servers). */
  extraOrigins: string[];
  /** Cross-origin cookie auth: needs CORS credentials plus trustedOrigins. */
  credentials: boolean;
}

export type CacheKind = "cloudflare-cdn" | "other-cdn";

export interface CacheConfig extends Integration {
  kind: CacheKind;
  ttlSeconds: number;
}

export type StorageKind = "s3" | "r2";

/**
 * Object storage for the media library. Credentials never live here:
 * `opencms setup` asks for them and writes `.env` / wrangler secrets.
 */
export interface S3Storage extends Integration {
  kind: "s3";
  bucket: string;
  endpoint?: string;
  region?: string;
  publicBaseUrl?: string;
}

export interface R2Storage extends Integration {
  kind: "r2";
  bucket: string;
  publicBaseUrl?: string;
}

export type StorageConfig = S3Storage | R2Storage;

export interface InitConfig {
  projectName: string;
  adminEmail: string;
  adminName: string;
  backend: BackendConfig;
  frontend?: FrontendConfig;
  cache?: CacheConfig;
  storage?: StorageConfig;
}

/** Identity helper so `opencms.config.ts` type-checks the whole object. */
export function defineConfig<T extends InitConfig>(config: T): T {
  return config;
}

export type HostedFrontendOptions = {
  url: string;
  extraOrigins?: string[];
  credentials?: boolean;
};

function hostedFrontend<H extends Exclude<FrontendHost, "same-origin">>(
  host: H,
  options: HostedFrontendOptions,
): FrontendConfig & { host: H } {
  return {
    host,
    url: options.url,
    extraOrigins: options.extraOrigins ?? [],
    credentials: options.credentials ?? false,
  };
}

export function vercel(options: HostedFrontendOptions) {
  return hostedFrontend("vercel", options);
}

export function netlify(options: HostedFrontendOptions) {
  return hostedFrontend("netlify", options);
}

export function cloudflarePages(options: HostedFrontendOptions) {
  return hostedFrontend("cloudflare-pages", options);
}

export function otherFrontend(options: HostedFrontendOptions) {
  return hostedFrontend("other", options);
}

export function sameOrigin(): FrontendConfig {
  return { host: "same-origin", extraOrigins: [], credentials: false };
}

/** Factory name each integration renders as in `opencms.config.ts`. */
export const BACKEND_FACTORY = {
  "bun-sqlite": "bunSqlite",
  cloudflare: "cloudflare",
} as const satisfies Record<BackendKind, string>;

export const FRONTEND_FACTORY = {
  vercel: "vercel",
  netlify: "netlify",
  "cloudflare-pages": "cloudflarePages",
  "same-origin": "sameOrigin",
  other: "otherFrontend",
} as const satisfies Record<FrontendHost, string>;

export const CACHE_FACTORY = {
  "cloudflare-cdn": "cloudflareCdn",
  "other-cdn": "otherCdn",
} as const satisfies Record<CacheKind, string>;

export const STORAGE_FACTORY = {
  s3: "s3",
  r2: "r2",
} as const satisfies Record<StorageKind, string>;

/** Validators return an error message to reprompt with, or undefined when valid. */

export function validateUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `"${value}" is not a valid URL. Expected something like https://example.com.`;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "The URL must start with http:// or https://.";
  }
  return undefined;
}

export function validateEmail(value: string): string | undefined {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? undefined
    : `"${value}" does not look like an email address.`;
}

export function validatePort(value: string): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? undefined
    : "The port must be an integer between 1 and 65535.";
}

export function validateTtl(value: string): string | undefined {
  const ttl = Number(value);
  return Number.isInteger(ttl) && ttl >= 1
    ? undefined
    : "The TTL must be a whole number of seconds, at least 1.";
}

/** S3/R2 bucket names: 3-63 chars, lowercase, digits, dots, dashes. */
export function validateBucket(value: string): string | undefined {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value)
    ? undefined
    : "Bucket names are 3-63 characters: lowercase letters, digits, dots and dashes.";
}

/** Worker and D1 names: lowercase alphanumerics and dashes, no edge dashes. */
export function validateCloudflareName(value: string): string | undefined {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value) && value.length <= 63
    ? undefined
    : "Use lowercase letters, digits and dashes (not at the start or end), 63 chars max.";
}

/** Bare hostname like cms.example.com; no scheme, no path. */
export function validateDomain(value: string): string | undefined {
  return /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/i.test(value)
    ? undefined
    : `"${value}" is not a bare domain name. Expected something like cms.example.com.`;
}

export function validateOriginList(value: string): string | undefined {
  for (const part of value.split(",").map((p) => p.trim()).filter(Boolean)) {
    const error = validateUrl(part);
    if (error) return error;
  }
  return undefined;
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

/** "https://a.com, http://localhost:5173" to deduped origins, order kept. */
export function parseOriginList(value: string): string[] {
  const origins = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(originOf);
  return [...new Set(origins)];
}

/** Every origin the frontend needs allowed; empty = keep the default wildcard. */
export function corsOrigins(config: InitConfig): string[] {
  const frontend = config.frontend;
  if (!frontend || frontend.host === "same-origin" || !frontend.url) return [];
  return [...new Set([originOf(frontend.url), ...frontend.extraOrigins])];
}

/**
 * Base URL the generated prompt verifies against. Before a Cloudflare deploy
 * without a custom domain the workers.dev subdomain is unknown, so the
 * placeholder is spelled out and the prompt tells the agent to substitute it.
 */
export function apiBaseUrl(backend: BackendConfig): string {
  if (backend.kind === "bun-sqlite") return backend.publicUrl.replace(/\/+$/, "");
  if (backend.customDomain) return `https://${backend.customDomain}`;
  return `https://${backend.workerName}.YOUR-SUBDOMAIN.workers.dev`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrow unknown JSON (from loading `opencms.config.ts`) to InitConfig.
 * Throws a readable error; never returns a half-valid object.
 */
export function assertInitConfig(value: unknown): InitConfig {
  if (!isRecord(value)) throw new Error("opencms.config.ts must default-export defineConfig({ ... }).");
  if (typeof value.projectName !== "string" || value.projectName.trim() === "") {
    throw new Error("opencms.config.ts: projectName is required.");
  }
  if (typeof value.adminEmail !== "string" || typeof value.adminName !== "string") {
    throw new Error("opencms.config.ts: adminEmail and adminName are required.");
  }
  if (!isRecord(value.backend) || (value.backend.kind !== "bun-sqlite" && value.backend.kind !== "cloudflare")) {
    throw new Error("opencms.config.ts: backend must be bunSqlite({ ... }) or cloudflare({ ... }).");
  }
  return value as unknown as InitConfig;
}
