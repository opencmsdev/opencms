/**
 * Core domain types. Everything infrastructure-facing is expressed against
 * these shapes; connectors never see Zod or service logic.
 */

export type FieldKind =
  | "text"
  | "richtext"
  | "number"
  | "boolean"
  | "date"
  | "select"
  | "json"
  | "reference"
  | "media";

export interface FieldDef {
  /** Machine name, unique within the content type. snake_case or camelCase. */
  name: string;
  /** Human label for the admin UI. */
  label?: string;
  kind: FieldKind;
  required?: boolean;
  /** Enforced by EntryService (application-level, connector-portable). */
  unique?: boolean;
  /**
   * When true the connector maintains a native index on this field
   * (JSON expression index on SQLite/D1, GIN/expression on Postgres).
   * Filtering or sorting on non-indexed fields still works, it just scans.
   */
  indexed?: boolean;
  /** For kind "select": the allowed values. */
  options?: string[];
  /** For kind "reference": the target content type name. */
  ref?: string;
  /** Default applied on create when the field is absent. */
  default?: unknown;
}

export interface ContentTypeDef {
  /** Machine name, e.g. "article". Lowercase, stable, used in URLs. */
  name: string;
  label: string;
  description?: string;
  fields: FieldDef[];
  /** Timestamps are managed by the system, not declared as fields. */
  createdAt: string;
  updatedAt: string;
}

/** What callers provide; timestamps are system-managed. */
export type ContentTypeInput = Omit<ContentTypeDef, "createdAt" | "updatedAt">;

export type EntryStatus = "draft" | "published";

export interface Entry {
  id: string;
  type: string;
  /** Unique per content type. Auto-generated from the first text field when absent. */
  slug: string;
  status: EntryStatus;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface EntryCreateInput {
  slug?: string;
  status?: EntryStatus;
  data: Record<string, unknown>;
}

export interface EntryUpdateInput {
  slug?: string;
  status?: EntryStatus;
  /** Partial patch; merged over existing data, then fully re-validated. */
  data?: Record<string, unknown>;
}

/** Fields that live as real columns, addressable in queries alongside data fields. */
export const SYSTEM_FIELDS = [
  "id",
  "slug",
  "status",
  "createdAt",
  "updatedAt",
  "publishedAt",
] as const;
export type SystemField = (typeof SYSTEM_FIELDS)[number];

export type FilterOp =
  | "eq"
  | "ne"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "in"
  | "nin"
  | "contains"
  | "exists";

export interface Filter {
  /** A system field or a data field name. */
  field: string;
  op: FilterOp;
  value?: unknown;
}

export interface Sort {
  field: string;
  dir: "asc" | "desc";
}

export interface EntryQuery {
  filter?: Filter[];
  sort?: Sort[];
  limit?: number;
  offset?: number;
}

export interface QueryResult<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
