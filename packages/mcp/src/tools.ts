import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  type ContentTypeService,
  type Entry,
  type EntryQuery,
  type EntryService,
  type Filter,
  type Sort,
} from "@opencms/core";
import type { Actor, ActorRole } from "@opencms/api";
import { fail, ok } from "./results.ts";

export interface ToolServices {
  types: ContentTypeService;
  entries: EntryService;
  actor: Actor;
}

const fieldKind = z.enum([
  "text",
  "richtext",
  "number",
  "boolean",
  "date",
  "select",
  "json",
  "reference",
  "media",
]);

const fieldDef = z.object({
  name: z.string(),
  label: z.string().optional(),
  kind: fieldKind,
  required: z.boolean().optional(),
  unique: z.boolean().optional(),
  indexed: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  ref: z.string().optional(),
  default: z.unknown().optional(),
});

const contentTypeInput = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string().optional(),
  fields: z.array(fieldDef),
});

const filterOp = z.enum([
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "nin",
  "contains",
  "exists",
]);

function requireRole(actor: Actor, min: ActorRole): void {
  if (!actor.role) throw new UnauthorizedError();
  if (min === "admin" && actor.role !== "admin") {
    throw new ForbiddenError("admin role required");
  }
}

function visibleTo(actor: Actor, entry: Entry): Entry {
  if (actor.role === null && entry.status !== "published") {
    throw new NotFoundError("entry not found");
  }
  return entry;
}

export function registerContentTools(server: McpServer, svc: ToolServices): void {
  const { types, entries, actor } = svc;

  server.registerTool(
    "list_content_types",
    {
      title: "List content types",
      description: "List every content type. Editors and admins only.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      try {
        requireRole(actor, "editor");
        return ok({ items: await types.list() });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "get_content_type",
    {
      title: "Get content type",
      description: "Fetch one content type by name. Editors and admins only.",
      inputSchema: z.object({ name: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ name }) => {
      try {
        requireRole(actor, "editor");
        return ok(await types.get(name));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "create_content_type",
    {
      title: "Create content type",
      description: "Create a content type. Admins only.",
      inputSchema: contentTypeInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (input) => {
      try {
        requireRole(actor, "admin");
        return ok(await types.create(input));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "update_content_type",
    {
      title: "Update content type",
      description: "Replace a content type definition. Admins only. Renaming is not supported.",
      inputSchema: contentTypeInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      try {
        requireRole(actor, "admin");
        return ok(await types.update(input.name, input));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "delete_content_type",
    {
      title: "Delete content type",
      description: "Delete a content type that has no entries. Admins only.",
      inputSchema: z.object({ name: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ name }) => {
      try {
        requireRole(actor, "admin");
        await types.delete(name);
        return ok({ ok: true });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "list_entries",
    {
      title: "List entries",
      description:
        "Query entries of a content type. Anonymous callers only see published entries.",
      inputSchema: z.object({
        type: z.string(),
        status: z.enum(["draft", "published"]).optional(),
        filter: z
          .array(
            z.object({
              field: z.string(),
              op: filterOp,
              value: z.unknown().optional(),
            })
          )
          .optional(),
        sort: z
          .array(z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }))
          .optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const query: EntryQuery = {
          filter: args.filter as Filter[] | undefined,
          sort: args.sort as Sort[] | undefined,
          limit: args.limit,
          offset: args.offset,
        };
        if (args.status) {
          query.filter = [...(query.filter ?? []), { field: "status", op: "eq", value: args.status }];
        }
        if (actor.role === null) {
          query.filter = [...(query.filter ?? []), { field: "status", op: "eq", value: "published" }];
        }
        return ok(await entries.query(args.type, query));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "get_entry",
    {
      title: "Get entry",
      description: "Fetch one entry by id. Anonymous callers cannot see drafts.",
      inputSchema: z.object({ type: z.string(), id: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ type, id }) => {
      try {
        return ok(visibleTo(actor, await entries.getById(type, id)));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "get_entry_by_slug",
    {
      title: "Get entry by slug",
      description: "Fetch one entry by slug. Anonymous callers cannot see drafts.",
      inputSchema: z.object({ type: z.string(), slug: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ type, slug }) => {
      try {
        return ok(visibleTo(actor, await entries.getBySlug(type, slug)));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "create_entry",
    {
      title: "Create entry",
      description: "Create an entry. Editors and admins only.",
      inputSchema: z.object({
        type: z.string(),
        slug: z.string().optional(),
        status: z.enum(["draft", "published"]).optional(),
        data: z.record(z.string(), z.unknown()).default({}),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ type, slug, status, data }) => {
      try {
        requireRole(actor, "editor");
        return ok(await entries.create(type, { slug, status, data }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "update_entry",
    {
      title: "Update entry",
      description: "Patch an entry. Editors and admins only.",
      inputSchema: z.object({
        type: z.string(),
        id: z.string(),
        slug: z.string().optional(),
        status: z.enum(["draft", "published"]).optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ type, id, slug, status, data }) => {
      try {
        requireRole(actor, "editor");
        return ok(await entries.update(type, id, { slug, status, data }));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "delete_entry",
    {
      title: "Delete entry",
      description: "Delete an entry. Editors and admins only.",
      inputSchema: z.object({ type: z.string(), id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ type, id }) => {
      try {
        requireRole(actor, "editor");
        await entries.delete(type, id);
        return ok({ ok: true });
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "publish_entry",
    {
      title: "Publish entry",
      description: "Set an entry to published. Editors and admins only.",
      inputSchema: z.object({ type: z.string(), id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ type, id }) => {
      try {
        requireRole(actor, "editor");
        return ok(await entries.publish(type, id));
      } catch (err) {
        return fail(err);
      }
    }
  );

  server.registerTool(
    "unpublish_entry",
    {
      title: "Unpublish entry",
      description: "Set an entry back to draft. Editors and admins only.",
      inputSchema: z.object({ type: z.string(), id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ type, id }) => {
      try {
        requireRole(actor, "editor");
        return ok(await entries.unpublish(type, id));
      } catch (err) {
        return fail(err);
      }
    }
  );
}
