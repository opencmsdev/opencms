/**
 * CORS for the OpenCMS API.
 *
 * A headless CMS is consumed by frontends that do not share its origin, so
 * cross-origin reads have to work out of the box. The default is therefore
 * `origin: "*"` with credentials off, which is the safe combination:
 *
 * - Anonymous reads only ever return published entries, so a wildcard exposes
 *   nothing that `curl` could not already fetch.
 * - With `Access-Control-Allow-Origin: *` a browser refuses to send cookies,
 *   so a session can never be ridden from another origin. The spec forbids
 *   pairing the wildcard with `Access-Control-Allow-Credentials`, and this
 *   module refuses to emit that combination even if it is configured.
 *
 * To let a browser send session cookies cross-origin, list the origins
 * explicitly and set `credentials: true`. Those same origins must also be
 * passed to `createAuth({ trustedOrigins })`, or better-auth will reject the
 * requests on CSRF grounds before they reach any route.
 */
import type { MiddlewareHandler } from "hono";

/**
 * Which origins may read responses. A function receives the raw `Origin`
 * header value and returns whether it is allowed.
 */
export type CorsOrigin = string | string[] | ((origin: string) => boolean);

export interface CorsOptions {
  /** Default `"*"`. */
  origin?: CorsOrigin;
  /**
   * Allow cookies and other credentials. Ignored when `origin` is `"*"`,
   * because the two are mutually exclusive per the Fetch standard.
   */
  credentials?: boolean;
  /** Request headers a browser may send. Default: content-type, x-api-key, authorization. */
  allowHeaders?: string[];
  /** Methods a browser may use. Default: the methods the API actually serves. */
  allowMethods?: string[];
  /** Response headers a browser may read beyond the CORS-safelisted set. Default: none. */
  exposeHeaders?: string[];
  /** Preflight cache lifetime in seconds. Default 86400 (24h). */
  maxAge?: number;
}

const DEFAULT_ALLOW_HEADERS = ["content-type", "x-api-key", "authorization"];
const DEFAULT_ALLOW_METHODS = ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"];
const DEFAULT_MAX_AGE = 86_400;

/** Resolve the value for Access-Control-Allow-Origin, or null to deny. */
function resolveOrigin(origin: string, allowed: CorsOrigin): string | null {
  if (allowed === "*") return "*";
  if (typeof allowed === "string") return allowed === origin ? origin : null;
  if (Array.isArray(allowed)) return allowed.includes(origin) ? origin : null;
  return allowed(origin) ? origin : null;
}

/**
 * Hono middleware implementing CORS. Requests without an `Origin` header are
 * passed through untouched: they are same-origin or not from a browser, and
 * CORS has nothing to say about them.
 */
export function cors(options: CorsOptions = {}): MiddlewareHandler {
  const allowed = options.origin ?? "*";
  const allowHeaders = (options.allowHeaders ?? DEFAULT_ALLOW_HEADERS).join(", ");
  const allowMethods = (options.allowMethods ?? DEFAULT_ALLOW_METHODS).join(", ");
  const exposeHeaders = (options.exposeHeaders ?? []).join(", ");
  const maxAge = String(options.maxAge ?? DEFAULT_MAX_AGE);
  // The wildcard and credentials cannot coexist; the wildcard wins, because
  // silently narrowing the origin would be a surprising security decision.
  const credentials = options.credentials === true && allowed !== "*";

  return async (c, next) => {
    const origin = c.req.header("origin");
    const preflight = c.req.method === "OPTIONS";

    if (!origin) {
      // A preflight without an Origin is malformed; answer it and stop rather
      // than letting it fall through to a 404 on a route that has no handler.
      if (preflight) return c.body(null, 204);
      return next();
    }

    const value = resolveOrigin(origin, allowed);

    if (value === null) {
      // Denied. Emit no CORS headers at all, which is what makes the browser
      // block the response. Preflights still get a 204 so the failure surfaces
      // as a CORS error rather than a confusing 404.
      if (preflight) return c.body(null, 204);
      return next();
    }

    const headers = new Headers();
    headers.set("access-control-allow-origin", value);
    // Any origin-dependent response must not be cached under one key.
    if (value !== "*") headers.append("vary", "Origin");
    if (credentials) headers.set("access-control-allow-credentials", "true");
    if (exposeHeaders) headers.set("access-control-expose-headers", exposeHeaders);

    if (preflight) {
      headers.set("access-control-allow-methods", allowMethods);
      headers.set("access-control-allow-headers", allowHeaders);
      headers.set("access-control-max-age", maxAge);
      headers.append("vary", "Access-Control-Request-Headers");
      return new Response(null, { status: 204, headers });
    }

    await next();
    headers.forEach((v, k) => {
      if (k === "vary") c.res.headers.append(k, v);
      else c.res.headers.set(k, v);
    });
  };
}
