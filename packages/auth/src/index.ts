import { betterAuth, type BetterAuthOptions } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { apiKey } from "@better-auth/api-key";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";

/**
 * Auth for OpenCMS, built on better-auth.
 *
 * Decisions encoded here:
 * - Email/password sessions for humans (the admin UI), API keys for machines.
 * - Two roles only: "admin" and "editor". Admins manage schema, users and
 *   keys; editors manage content. Public reads are handled in @opencms/api.
 * - Bootstrap: the very first signup becomes the admin, then signup closes.
 *   Further users are created by admins through the admin plugin.
 * - API keys carry a role in their metadata and are sent as `x-api-key`.
 *   Key management over HTTP is admin-only.
 *
 * The auth tables live in the same database as the content tables: pass the
 * same bun:sqlite Database or D1 binding the data connector uses.
 */

export const ROLES = ["admin", "editor"] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Whatever better-auth accepts: bun:sqlite Database, D1Database, Kysely dialect... */
export type AuthDatabase = NonNullable<BetterAuthOptions["database"]>;

export interface CreateAuthOptions {
  database: AuthDatabase;
  /** Session/cookie signing secret. Required, no default: never ship a known secret. */
  secret: string;
  /** Canonical URL of the API, e.g. http://localhost:3000. */
  baseURL?: string;
  /** Extra origins allowed to send credentialed requests (the admin SPA). */
  trustedOrigins?: string[];
}

/** Paths (relative to /api/auth) whose HTTP access is restricted to admins. */
const ADMIN_ONLY_KEY_PATHS = new Set([
  "/api-key/create",
  "/api-key/update",
  "/api-key/delete",
  "/api-key/delete-all-expired-api-keys",
  "/api-key/get",
  "/api-key/list",
  "/api-key/verify",
]);

export function createAuth(options: CreateAuthOptions) {
  if (!options.secret) {
    throw new Error("@opencms/auth: `secret` is required (set BETTER_AUTH_SECRET)");
  }

  return betterAuth({
    database: options.database,
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: "/api/auth",
    trustedOrigins: options.trustedOrigins,
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
    },
    plugins: [
      admin({
        defaultRole: "editor",
        adminRoles: ["admin"],
      }),
      apiKey({
        enableMetadata: true,
        defaultPrefix: "ocms_",
        // Machine keys; the 10-requests-per-day plugin default would break
        // every headless consumer. Rate limiting belongs at the edge.
        rateLimit: { enabled: false },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          // The first user ever created is the admin. Later users get
          // whatever role their creation path set (defaultRole or the
          // admin plugin's create-user body).
          before: async (user, ctx) => {
            if (!ctx) return { data: user };
            const existing = await ctx.context.adapter.count({ model: "user" });
            if (existing === 0) return { data: { ...user, role: "admin" } };
            return { data: user };
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Server-side auth.api.* calls have no ctx.request; the gates below
        // only apply to real HTTP traffic.
        if (!ctx.request) return;

        // Signup is open only for bootstrap. Once a user exists, accounts
        // are created by admins via the admin plugin.
        if (ctx.path === "/sign-up/email") {
          const existing = await ctx.context.adapter.count({ model: "user" });
          if (existing > 0) {
            throw new APIError("FORBIDDEN", {
              message: "signup is closed; ask an admin to create your account",
            });
          }
          return;
        }

        // API key management over HTTP is admin-only, and every key gets a
        // validated role in its metadata (defaulting to editor).
        if (ADMIN_ONLY_KEY_PATHS.has(ctx.path)) {
          const session = await getSessionFromCtx(ctx);
          const role = (session?.user as { role?: string } | undefined)?.role;
          if (!session || role !== "admin") {
            throw new APIError("FORBIDDEN", {
              message: "API key management requires an admin session",
            });
          }
          if (ctx.path === "/api-key/create" || ctx.path === "/api-key/update") {
            const body = (ctx.body ?? {}) as { metadata?: Record<string, unknown> };
            const requested = body.metadata?.role ?? "editor";
            if (!isRole(requested)) {
              throw new APIError("BAD_REQUEST", {
                message: `API key role must be one of: ${ROLES.join(", ")}`,
              });
            }
            ctx.body = { ...body, metadata: { ...body.metadata, role: requested } };
          }
        }
      }),
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/**
 * Adapt an Auth instance to the shape @opencms/api consumes (its structural
 * `AuthConnector`). better-auth endpoint functions carry elaborate
 * union-typed parameters (asResponse and friends) that defeat direct
 * structural assignment; this pins the three calls the API needs down to
 * plain functions.
 */
export function toAuthConnector(auth: Auth) {
  return {
    handler: (request: Request): Promise<Response> => auth.handler(request),
    api: {
      getSession: (input: { headers: Headers }) =>
        auth.api.getSession({ headers: input.headers }),
      verifyApiKey: (input: { body: { key: string } }) =>
        auth.api.verifyApiKey({ body: input.body }),
    },
  };
}

/**
 * Create or update the auth tables. Idempotent, safe to run on every boot.
 * Works on every Kysely-backed database better-auth supports, which covers
 * both first-party profiles (bun:sqlite and D1).
 */
export async function runAuthMigrations(auth: Auth): Promise<void> {
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
}
