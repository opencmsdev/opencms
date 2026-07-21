/**
 * Thin fetch client for the Admin API and the better-auth endpoints.
 * Same-origin everywhere (Vite proxy in dev, API-served assets in prod),
 * so session cookies flow without any CORS configuration.
 */

export interface FieldDef {
  name: string;
  label?: string;
  kind:
    | "text"
    | "richtext"
    | "number"
    | "boolean"
    | "date"
    | "select"
    | "json"
    | "reference"
    | "media";
  required?: boolean;
  unique?: boolean;
  indexed?: boolean;
  options?: string[];
  ref?: string;
  default?: unknown;
}

export interface ContentTypeDef {
  name: string;
  label: string;
  description?: string;
  fields: FieldDef[];
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  type: string;
  slug: string;
  status: "draft" | "published";
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface QueryResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "editor";
}

export interface AdminUser extends SessionUser {
  createdAt: string;
  banned?: boolean | null;
}

export interface ApiKeySummary {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  metadata: { role?: string } | null;
  createdAt: string;
  expiresAt: string | null;
  lastRequest: string | null;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues?: { path: string; message: string }[]
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, body?.message ?? `request failed (${res.status})`, body?.issues);
  }
  return body as T;
}

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  // Setup + session ---------------------------------------------------------
  needsSetup: () => request<{ needsSetup: boolean }>("/api/setup"),
  getSession: () =>
    request<{ user: SessionUser } | null>("/api/auth/get-session"),
  signUp: (input: { email: string; password: string; name: string }) =>
    request<unknown>("/api/auth/sign-up/email", post(input)),
  signIn: (input: { email: string; password: string }) =>
    request<unknown>("/api/auth/sign-in/email", post(input)),
  signOut: () => request<unknown>("/api/auth/sign-out", post({})),

  // Content types -----------------------------------------------------------
  listTypes: () => request<{ items: ContentTypeDef[] }>("/api/content-types"),
  getType: (name: string) => request<ContentTypeDef>(`/api/content-types/${name}`),
  createType: (def: Omit<ContentTypeDef, "createdAt" | "updatedAt">) =>
    request<ContentTypeDef>("/api/content-types", post(def)),
  updateType: (name: string, def: Omit<ContentTypeDef, "createdAt" | "updatedAt">) =>
    request<ContentTypeDef>(`/api/content-types/${name}`, {
      ...post(def),
      method: "PUT",
    }),
  deleteType: (name: string) =>
    request<null>(`/api/content-types/${name}`, { method: "DELETE" }),

  // Entries -----------------------------------------------------------------
  listEntries: (type: string, params: URLSearchParams) =>
    request<QueryResult<Entry>>(`/api/content/${type}?${params.toString()}`),
  getEntry: (type: string, id: string) => request<Entry>(`/api/content/${type}/${id}`),
  createEntry: (
    type: string,
    input: { slug?: string; status?: "draft" | "published"; data: Record<string, unknown> }
  ) => request<Entry>(`/api/content/${type}`, post(input)),
  updateEntry: (
    type: string,
    id: string,
    input: { slug?: string; status?: "draft" | "published"; data?: Record<string, unknown> }
  ) => request<Entry>(`/api/content/${type}/${id}`, { ...post(input), method: "PATCH" }),
  deleteEntry: (type: string, id: string) =>
    request<null>(`/api/content/${type}/${id}`, { method: "DELETE" }),
  publishEntry: (type: string, id: string) =>
    request<Entry>(`/api/content/${type}/${id}/publish`, { method: "POST" }),
  unpublishEntry: (type: string, id: string) =>
    request<Entry>(`/api/content/${type}/${id}/unpublish`, { method: "POST" }),

  // Users (better-auth admin plugin) ---------------------------------------
  listUsers: () =>
    request<{ users: AdminUser[]; total: number }>(
      "/api/auth/admin/list-users?limit=200&sortBy=createdAt&sortDirection=asc"
    ),
  createUser: (input: { email: string; password: string; name: string; role: "admin" | "editor" }) =>
    request<{ user: AdminUser }>("/api/auth/admin/create-user", post(input)),
  setRole: (userId: string, role: "admin" | "editor") =>
    request<unknown>("/api/auth/admin/set-role", post({ userId, role })),

  // API keys (better-auth api-key plugin) -----------------------------------
  listKeys: () =>
    request<{ apiKeys: ApiKeySummary[]; total: number }>("/api/auth/api-key/list"),
  createKey: (input: { name: string; role: "admin" | "editor" }) =>
    request<ApiKeySummary & { key: string }>(
      "/api/auth/api-key/create",
      post({ name: input.name, metadata: { role: input.role } })
    ),
  deleteKey: (keyId: string) => request<unknown>("/api/auth/api-key/delete", post({ keyId })),
};
