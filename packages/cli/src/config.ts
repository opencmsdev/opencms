/**
 * The wizard's output model and the validators the prompts use. The two
 * backend kinds mirror the two profiles the repo ships: apps/dev (Bun +
 * SQLite) and apps/worker (Cloudflare Workers + D1).
 */

export type BackendKind = "bun-sqlite" | "cloudflare";

export interface SelfHostedBackend {
  kind: "bun-sqlite";
  /** Canonical URL the API is reached at, e.g. http://localhost:3000. */
  publicUrl: string;
  port: number;
  dbPath: string;
}

export interface CloudflareBackend {
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

export interface CacheConfig {
  kind: CacheKind;
  ttlSeconds: number;
}

export interface InitConfig {
  projectName: string;
  adminEmail: string;
  adminName: string;
  backend: BackendConfig;
  frontend?: FrontendConfig;
  cache?: CacheConfig;
}

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
