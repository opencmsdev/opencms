import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import {
  ContentTypeService,
  EntryService,
  ForbiddenError,
  NotFoundError,
  OpenCMSError,
  UnauthorizedError,
  ValidationError,
  type DataConnector,
  type Entry,
  type EntryQuery,
  type Filter,
  type Sort,
} from "@opencms/core";

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
  const app = new Hono<AppEnv>();

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

  app.get("/health", (c) => c.json({ ok: true, name: "opencms" }));

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
    c.json({ needsSetup: (await opts.auth.needsSetup?.()) ?? false })
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
    return c.json(await types.update(c.req.param("name"), body as never));
  });

  app.delete("/api/content-types/:name", requireRole("admin"), async (c) => {
    await types.delete(c.req.param("name"));
    return c.body(null, 204);
  });

  // Entries ---------------------------------------------------------------------
  // Reads are public but anonymous requests only ever see published entries.
  app.get("/api/content/:type", async (c) => {
    const query = parseQuery(new URL(c.req.url));
    if (c.get("actor").role === null) {
      query.filter = [
        ...(query.filter ?? []),
        { field: "status", op: "eq", value: "published" },
      ];
    }
    return c.json(await entries.query(c.req.param("type"), query));
  });

  app.post("/api/content/:type", requireRole("editor"), async (c) => {
    const body = entryCreateSchema.safeParse(await jsonBody(c));
    if (!body.success) {
      throw new ValidationError("invalid entry payload", [
        { path: "body", message: "expected {slug?, status?, data}" },
      ]);
    }
    const created = await entries.create(c.req.param("type"), body.data);
    return c.json(created, 201);
  });

  app.get("/api/content/:type/slug/:slug", async (c) =>
    c.json(
      visibleTo(
        c.get("actor"),
        await entries.getBySlug(c.req.param("type"), c.req.param("slug"))
      )
    )
  );

  app.get("/api/content/:type/:id", async (c) =>
    c.json(
      visibleTo(c.get("actor"), await entries.getById(c.req.param("type"), c.req.param("id")))
    )
  );

  app.patch("/api/content/:type/:id", requireRole("editor"), async (c) => {
    const body = entryUpdateSchema.safeParse(await jsonBody(c));
    if (!body.success) {
      throw new ValidationError("invalid entry payload", [
        { path: "body", message: "expected {slug?, status?, data?}" },
      ]);
    }
    return c.json(await entries.update(c.req.param("type"), c.req.param("id"), body.data));
  });

  app.delete("/api/content/:type/:id", requireRole("editor"), async (c) => {
    await entries.delete(c.req.param("type"), c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/api/content/:type/:id/publish", requireRole("editor"), async (c) =>
    c.json(await entries.publish(c.req.param("type"), c.req.param("id")))
  );

  app.post("/api/content/:type/:id/unpublish", requireRole("editor"), async (c) =>
    c.json(await entries.unpublish(c.req.param("type"), c.req.param("id")))
  );

  return app;
}
