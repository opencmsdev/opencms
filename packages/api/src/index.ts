import { Hono } from "hono";
import { z } from "zod";
import {
  ContentTypeService,
  EntryService,
  NotFoundError,
  OpenCMSError,
  ValidationError,
  type DataConnector,
  type EntryQuery,
  type Filter,
  type Sort,
} from "@opencms/core";

/**
 * The Admin API as a runtime-agnostic Hono app.
 *
 * Bun:                Bun.serve({ fetch: createApp({ data }).fetch })
 * Cloudflare Workers: export default createApp({ data })
 *
 * Auth is intentionally absent in this milestone; it arrives with the admin
 * UI (better-auth) and will wrap this app as middleware.
 */

export interface CreateAppOptions {
  data: DataConnector;
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

export function createApp(opts: CreateAppOptions): Hono {
  const types = new ContentTypeService(opts.data);
  const entries = new EntryService(opts.data);
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ValidationError) {
      return c.json({ error: err.code, message: err.message, issues: err.issues }, 400);
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

  // Content types -------------------------------------------------------------
  app.get("/api/content-types", async (c) => c.json({ items: await types.list() }));

  app.post("/api/content-types", async (c) => {
    const body = await jsonBody(c);
    const created = await types.create(body as never);
    return c.json(created, 201);
  });

  app.get("/api/content-types/:name", async (c) => c.json(await types.get(c.req.param("name"))));

  app.put("/api/content-types/:name", async (c) => {
    const body = await jsonBody(c);
    return c.json(await types.update(c.req.param("name"), body as never));
  });

  app.delete("/api/content-types/:name", async (c) => {
    await types.delete(c.req.param("name"));
    return c.body(null, 204);
  });

  // Entries ---------------------------------------------------------------------
  app.get("/api/content/:type", async (c) => {
    const query = parseQuery(new URL(c.req.url));
    return c.json(await entries.query(c.req.param("type"), query));
  });

  app.post("/api/content/:type", async (c) => {
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
    c.json(await entries.getBySlug(c.req.param("type"), c.req.param("slug")))
  );

  app.get("/api/content/:type/:id", async (c) =>
    c.json(await entries.getById(c.req.param("type"), c.req.param("id")))
  );

  app.patch("/api/content/:type/:id", async (c) => {
    const body = entryUpdateSchema.safeParse(await jsonBody(c));
    if (!body.success) {
      throw new ValidationError("invalid entry payload", [
        { path: "body", message: "expected {slug?, status?, data?}" },
      ]);
    }
    return c.json(await entries.update(c.req.param("type"), c.req.param("id"), body.data));
  });

  app.delete("/api/content/:type/:id", async (c) => {
    await entries.delete(c.req.param("type"), c.req.param("id"));
    return c.body(null, 204);
  });

  app.post("/api/content/:type/:id/publish", async (c) =>
    c.json(await entries.publish(c.req.param("type"), c.req.param("id")))
  );

  app.post("/api/content/:type/:id/unpublish", async (c) =>
    c.json(await entries.unpublish(c.req.param("type"), c.req.param("id")))
  );

  return app;
}
