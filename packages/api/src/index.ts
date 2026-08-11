import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  ContentTypeService,
  EntryService,
  ForbiddenError,
  MediaService,
  NotFoundError,
  OpenCMSError,
  UnauthorizedError,
  ValidationError,
  type CacheConnector,
  type DataConnector,
  type Entry,
  type EntryQuery,
  type Filter,
  type Sort,
  type StorageConnector,
  VERSION,
} from "@opencms/core";
import { cors, type CorsOptions, type CorsOrigin } from "./cors.ts";

export { cors, type CorsOptions, type CorsOrigin };

/**
 * The Admin API as a runtime-agnostic Hono app.
 *
 * Bun:                Bun.serve({ fetch: createApp({ data, auth }).fetch })
 * Cloudflare Workers: export default createApp({ data, auth })
 *
 * Access model (M3):
 * - better-auth is mounted at /api/auth/* (sessions, users, API keys).
 * - Requests authenticate with a session cookie or an `x-api-key` header.
 * - Anonymous requests can read published entries only.
 * - Editors (and every valid API key by default) manage content.
 * - Admins additionally manage content types, users and API keys.
 */

export type ActorRole = "admin" | "editor";

export interface Actor {
  kind: "session" | "api-key" | "anonymous";
  /** null means anonymous: published-content reads only. */
  role: ActorRole | null;
  userId: string | null;
}

/**
 * The slice of a better-auth instance the API needs. Structural on purpose:
 * @opencms/api stays decoupled from better-auth's types, and anything that
 * can answer these three calls (e.g. a stub in tests) is a valid auth source.
 */
export interface AuthConnector {
  handler: (request: Request) => Promise<Response>;
  /** True while no user exists yet (the admin UI shows first-run setup). */
  needsSetup?: () => Promise<boolean>;
  api: {
    getSession: (input: {
      headers: Headers;
    }) => Promise<{ user: { id: string; role?: string | null } } | null>;
    verifyApiKey: (input: { body: { key: string } }) => Promise<{
      valid: boolean;
      /** referenceId is the owning user's id (better-auth api-key model). */
      key: { referenceId: string; metadata?: unknown } | null;
    }>;
  };
}

export interface CreateAppOptions {
  data: DataConnector;
  auth: AuthConnector;
  /**
   * Object storage for the media library. Optional: without it the media
   * routes answer 404 with a clear message and `GET /api/setup` reports
   * `media: false` so the admin UI hides the library.
   */
  storage?: StorageConnector;
  /**
   * Cross-origin access for browser clients. Defaults to `origin: "*"` with
   * credentials off, so a frontend on any origin can read published content
   * while cookies stay same-origin. Pass `false` to emit no CORS headers.
   */
  cors?: CorsOptions | false;
  /**
   * Opt-in read cache for ANONYMOUS content reads (the only requests whose
   * responses are cookie-independent and published-only by construction).
   * Writes to a type invalidate it by bumping a per-type generation key, so
   * invalidation is one `set` and needs no prefix scans; stale generations
   * age out through the TTL. On an eventually-consistent backend (KV) other
   * regions may serve the previous generation briefly.
   */
  cache?: { connector: CacheConnector; ttlSeconds?: number };
}

const CACHE_DEFAULT_TTL_SECONDS = 60;

/** djb2-xor, hex. Collision-tolerant use only: a stale hit is another query's
 * cached JSON, which the TTL bounds; keys stay short for KV's 512-byte cap. */
function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

/** Anonymous read-through cache with per-type generations. */
class ReadCache {
  constructor(
    private readonly cache: CacheConnector,
    private readonly ttlSeconds: number
  ) {}

  private genKey(type: string): string {
    return `oc1:gen:${type}`;
  }

  private async generation(type: string): Promise<string> {
    return (await this.cache.get(this.genKey(type))) ?? "0";
  }

  async invalidate(type: string): Promise<void> {
    const next = Number(await this.generation(type)) + 1;
    // No TTL: losing the generation key must never resurrect old entries,
    // and a missing key falls back to generation 0, which bumping leaves.
    await this.cache.set(this.genKey(type), String(next));
  }

  async lookup(type: string, request: string): Promise<{ key: string; hit: string | null }> {
    const gen = await this.generation(type);
    const key = `oc1:read:${type}:${gen}:${hashKey(request)}`;
    return { key, hit: await this.cache.get(key) };
  }

  async store(key: string, body: string): Promise<void> {
    await this.cache.set(key, body, { ttlSeconds: this.ttlSeconds });
  }
}

const entryCreateSchema = z
  .object({
    slug: z.string().optional(),
    status: z.enum(["draft", "published"]).optional(),
    data: z.record(z.unknown()).default({}),
  })
  .strict();

const entryUpdateSchema = z
  .object({
    slug: z.string().optional(),
    status: z.enum(["draft", "published"]).optional(),
    data: z.record(z.unknown()).optional(),
  })
  .strict();

const filterSchema: z.ZodType<Filter> = z
  .object({
    field: z.string().min(1),
    op: z.enum(["eq", "ne", "lt", "lte", "gt", "gte", "in", "nin", "contains", "exists"]),
    value: z.unknown().optional(),
  })
  .strict();

function parseQuery(url: URL): EntryQuery {
  const query: EntryQuery = {};

  const where = url.searchParams.get("where");
  if (where) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(where);
    } catch {
      throw new ValidationError("`where` must be URL-encoded JSON", [
        { path: "where", message: "invalid JSON" },
      ]);
    }
    const filters = z.array(filterSchema).safeParse(parsed);
    if (!filters.success) {
      throw new ValidationError("invalid `where` filters", [
        { path: "where", message: "expected an array of {field, op, value}" },
      ]);
    }
    query.filter = filters.data;
  }

  const status = url.searchParams.get("status");
  if (status === "draft" || status === "published") {
    query.filter = [...(query.filter ?? []), { field: "status", op: "eq", value: status }];
  }

  const sort = url.searchParams.get("sort");
  if (sort) {
    query.sort = sort.split(",").map((part): Sort => {
      const [field, dir] = part.split(":");
      if (!field || (dir && dir !== "asc" && dir !== "desc")) {
        throw new ValidationError("invalid `sort`", [
          { path: "sort", message: "expected field:asc|desc[,field:dir]" },
        ]);
      }
      return { field, dir: dir === "desc" ? "desc" : "asc" };
    });
  }

  const limit = url.searchParams.get("limit");
  if (limit !== null) query.limit = Number(limit);
  const offset = url.searchParams.get("offset");
  if (offset !== null) query.offset = Number(offset);
  if (
    (query.limit !== undefined && !Number.isInteger(query.limit)) ||
    (query.offset !== undefined && !Number.isInteger(query.offset))
  ) {
    throw new ValidationError("limit and offset must be integers");
  }
  return query;
}

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ValidationError("request body must be JSON");
  }
}

function toActorRole(value: unknown): ActorRole {
  return value === "admin" ? "admin" : "editor";
}

async function resolveActor(auth: AuthConnector, headers: Headers): Promise<Actor> {
  const apiKey = headers.get("x-api-key");
  if (apiKey) {
    const result = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!result.valid || !result.key) {
      throw new UnauthorizedError("invalid API key");
    }
    const metadata = (result.key.metadata ?? {}) as { role?: unknown };
    return { kind: "api-key", role: toActorRole(metadata.role), userId: result.key.referenceId };
  }

  const session = await auth.api.getSession({ headers });
  if (session) {
    return { kind: "session", role: toActorRole(session.user.role), userId: session.user.id };
  }

  return { kind: "anonymous", role: null, userId: null };
}

type AppEnv = { Variables: { actor: Actor } };

function requireRole(min: ActorRole): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const actor = c.get("actor");
    if (!actor.role) throw new UnauthorizedError();
    if (min === "admin" && actor.role !== "admin") {
      throw new ForbiddenError("admin role required");
    }
    await next();
  };
}

/** Anonymous readers never see drafts; pretend they don't exist. */
function visibleTo(actor: Actor, entry: Entry): Entry {
  if (actor.role === null && entry.status !== "published") {
    throw new NotFoundError("entry not found");
  }
  return entry;
}

export function createApp(opts: CreateAppOptions): Hono<AppEnv> {
  const types = new ContentTypeService(opts.data);
  const entries = new EntryService(opts.data);
  const readCache = opts.cache
    ? new ReadCache(opts.cache.connector, opts.cache.ttlSeconds ?? CACHE_DEFAULT_TTL_SECONDS)
    : null;
  /** Fire on every successful write touching a type's content or schema. */
  const invalidate = async (type: string) => {
    await readCache?.invalidate(type);
  };
  const app = new Hono<AppEnv>();

  // First in the chain: a preflight carries no credentials, so it must be
  // answered before anything tries to resolve an actor from it.
  if (opts.cors !== false) app.use("*", cors(opts.cors));

  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ error: err.code, message: err.message, issues: err.issues }, 400);
    }
    if (err instanceof UnauthorizedError) {
      return c.json({ error: err.code, message: err.message }, 401);
    }
    if (err instanceof ForbiddenError) {
      return c.json({ error: err.code, message: err.message }, 403);
    }
    if (err instanceof NotFoundError) {
      return c.json({ error: err.code, message: err.message }, 404);
    }
    if (err instanceof OpenCMSError && err.code === "conflict") {
      return c.json({ error: err.code, message: err.message }, 409);
    }
    console.error(err);
    return c.json({ error: "internal", message: "internal server error" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true, name: "opencms", version: VERSION }));

  // Auth ----------------------------------------------------------------------
  // better-auth owns everything under /api/auth/*: sign-in/out, session,
  // user management (admin plugin) and API keys (api-key plugin).
  app.on(["GET", "POST"], "/api/auth/*", (c) => opts.auth.handler(c.req.raw));

  // Every other /api route resolves an actor first. A bad API key is a hard
  // 401 rather than a downgrade to anonymous, so misconfigured clients fail
  // loudly instead of silently reading only published content.
  app.use("/api/*", async (c, next) => {
    c.set("actor", await resolveActor(opts.auth, c.req.raw.headers));
    await next();
  });

  // Public first-run probe: tells the admin UI whether to show the setup
  // screen. Leaks only the boolean "a user exists", which the closed signup
  // endpoint reveals anyway.
  app.get("/api/setup", async (c) =>
    c.json({
      needsSetup: (await opts.auth.needsSetup?.()) ?? false,
      media: opts.storage !== undefined,
    })
  );

  // Content types -------------------------------------------------------------
  // Schema is the admins' domain; editors may read it (the entry editor
  // needs field definitions), anonymous consumers may not.
  app.get("/api/content-types", requireRole("editor"), async (c) =>
    c.json({ items: await types.list() })
  );

  app.post("/api/content-types", requireRole("admin"), async (c) => {
    const body = await jsonBody(c);
    const created = await types.create(body as never);
    return c.json(created, 201);
  });

  app.get("/api/content-types/:name", requireRole("editor"), async (c) =>
    c.json(await types.get(c.req.param("name")))
  );

  app.put("/api/content-types/:name", requireRole("admin"), async (c) => {
    const body = await jsonBody(c);
    const updated = await types.update(c.req.param("name"), body as never);
    await invalidate(updated.name);
    return c.json(updated);
  });

  app.delete("/api/content-types/:name", requireRole("admin"), async (c) => {
    await types.delete(c.req.param("name"));
    await invalidate(c.req.param("name"));
    return c.body(null, 204);
  });

  /**
   * Serve an anonymous read through the cache when one is configured.
   * Only anonymous responses are cacheable: they are cookie-independent and
   * published-only by construction. 404s (drafts included) are never cached,
   * so a publish becomes visible immediately even without invalidation.
   */
  async function cachedJson(
    c: Context<AppEnv>,
    type: string,
    produce: () => Promise<unknown>
  ): Promise<Response> {
    if (!readCache || c.get("actor").role !== null) {
      return c.json(await produce());
    }
    const url = new URL(c.req.url);
    const request = `${url.pathname}?${url.searchParams.toString()}`;
    const { key, hit } = await readCache.lookup(type, request);
    if (hit !== null) {
      return c.body(hit, 200, {
        "content-type": "application/json",
        "x-opencms-cache": "hit",
      });
    }
    const body = JSON.stringify(await produce());
    await readCache.store(key, body);
    return c.body(body, 200, {
      "content-type": "application/json",
      "x-opencms-cache": "miss",
    });
  }

  // Entries ---------------------------------------------------------------------
  // Reads are public but anonymous requests only ever see published entries.
  app.get("/api/content/:type", async (c) => {
    const type = c.req.param("type");
    return cachedJson(c, type, async () => {
      const query = parseQuery(new URL(c.req.url));
      if (c.get("actor").role === null) {
        query.filter = [
          ...(query.filter ?? []),
          { field: "status", op: "eq", value: "published" },
        ];
      }
      return entries.query(type, query);
    });
  });

  app.post("/api/content/:type", requireRole("editor"), async (c) => {
    const body = entryCreateSchema.safeParse(await jsonBody(c));
    if (!body.success) {
      throw new ValidationError("invalid entry payload", [
        { path: "body", message: "expected {slug?, status?, data}" },
      ]);
    }
    const created = await entries.create(c.req.param("type"), body.data);
    await invalidate(c.req.param("type"));
    return c.json(created, 201);
  });

  app.get("/api/content/:type/slug/:slug", async (c) => {
    const type = c.req.param("type");
    return cachedJson(c, type, async () =>
      visibleTo(c.get("actor"), await entries.getBySlug(type, c.req.param("slug")))
    );
  });

  app.get("/api/content/:type/:id", async (c) => {
    const type = c.req.param("type");
    return cachedJson(c, type, async () =>
      visibleTo(c.get("actor"), await entries.getById(type, c.req.param("id")))
    );
  });

  app.patch("/api/content/:type/:id", requireRole("editor"), async (c) => {
    const body = entryUpdateSchema.safeParse(await jsonBody(c));
    if (!body.success) {
      throw new ValidationError("invalid entry payload", [
        { path: "body", message: "expected {slug?, status?, data?}" },
      ]);
    }
    const updated = await entries.update(c.req.param("type"), c.req.param("id"), body.data);
    await invalidate(c.req.param("type"));
    return c.json(updated);
  });

  app.delete("/api/content/:type/:id", requireRole("editor"), async (c) => {
    await entries.delete(c.req.param("type"), c.req.param("id"));
    await invalidate(c.req.param("type"));
    return c.body(null, 204);
  });

  app.post("/api/content/:type/:id/publish", requireRole("editor"), async (c) => {
    const published = await entries.publish(c.req.param("type"), c.req.param("id"));
    await invalidate(c.req.param("type"));
    return c.json(published);
  });

  app.post("/api/content/:type/:id/unpublish", requireRole("editor"), async (c) => {
    const unpublished = await entries.unpublish(c.req.param("type"), c.req.param("id"));
    await invalidate(c.req.param("type"));
    return c.json(unpublished);
  });

  // Media ---------------------------------------------------------------------
  // Reads are public and anonymous, matching published entries: a headless
  // CMS whose images need a token to embed defeats the point. Writes are the
  // editors' domain, like any other content.
  const media = opts.storage ? new MediaService(opts.storage) : null;

  /** The routes exist either way so an unconfigured install fails clearly. */
  function mediaOrThrow(): MediaService {
    if (!media) {
      throw new NotFoundError(
        "media is not configured: pass a storage connector to createApp"
      );
    }
    return media;
  }

  /** Key = the encoded path after /api/media/, decoded segment by segment. */
  function mediaKey(c: { req: { path: string } }): string {
    const raw = c.req.path.slice("/api/media/".length);
    try {
      return raw.split("/").map(decodeURIComponent).join("/");
    } catch {
      throw new ValidationError(`invalid media key "${raw}"`);
    }
  }

  app.post("/api/media", requireRole("editor"), async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      throw new ValidationError("expected multipart/form-data with a `file` part");
    }
    const info = await mediaOrThrow().upload(file.name, file.stream(), {
      contentType: file.type || "application/octet-stream",
      contentLength: file.size,
    });
    return c.json({ ...info, url: `/api/media/${info.key}` }, 201);
  });

  app.get("/api/media", requireRole("editor"), async (c) => {
    const url = new URL(c.req.url);
    const limit = url.searchParams.get("limit");
    if (limit !== null && !Number.isInteger(Number(limit))) {
      throw new ValidationError("limit must be an integer");
    }
    return c.json(
      await mediaOrThrow().list({
        prefix: url.searchParams.get("prefix") ?? undefined,
        limit: limit !== null ? Number(limit) : undefined,
        cursor: url.searchParams.get("cursor") ?? undefined,
      })
    );
  });

  app.get("/api/media/*", async (c) => {
    const svc = mediaOrThrow();
    const key = mediaKey(c);

    // Backends with a public base (e.g. an R2 custom domain) serve their own
    // bytes; everything else streams through the API.
    const direct = await svc.publicUrl(key);
    if (direct) return c.redirect(direct, 302);

    const { info, body } = await svc.serve(key);
    return c.body(body, 200, {
      "content-type": info.contentType,
      "content-length": String(info.size),
      // Generated keys are unique per upload, so the bytes behind a key
      // never legitimately change.
      "cache-control": "public, max-age=31536000, immutable",
    });
  });

  app.delete("/api/media/*", requireRole("editor"), async (c) => {
    await mediaOrThrow().delete(mediaKey(c));
    return c.body(null, 204);
  });

  return app;
}
