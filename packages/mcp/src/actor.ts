import type { Actor, ActorRole, AuthConnector } from "@opencms/api";
import { UnauthorizedError } from "@opencms/core";

export const ANONYMOUS: Actor = { kind: "anonymous", role: null, userId: null };

function toActorRole(value: unknown): ActorRole {
  return value === "admin" ? "admin" : "editor";
}

function bearerToken(headers: Headers): string | null {
  const raw = headers.get("authorization");
  if (!raw) return null;
  const match = /^Bearer\s+(\S+)/i.exec(raw);
  return match?.[1] ?? null;
}

/**
 * Same RBAC as the REST API, plus `Authorization: Bearer` so MCP clients
 * that cannot set `x-api-key` still authenticate. A bad key is a hard 401,
 * never a silent downgrade to anonymous.
 */
export async function resolveActor(auth: AuthConnector, headers: Headers): Promise<Actor> {
  const apiKey = headers.get("x-api-key") ?? bearerToken(headers);
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

  return ANONYMOUS;
}
