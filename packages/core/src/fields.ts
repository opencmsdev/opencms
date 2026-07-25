import { z } from "zod";
import type { ContentTypeInput, FieldDef } from "./types.ts";
import { SYSTEM_FIELDS } from "./types.ts";
import { ValidationError, type ValidationIssue } from "./errors.ts";

const FIELD_NAME_RE = /^[a-z][a-zA-Z0-9_]{0,63}$/;
const TYPE_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

const RESERVED_FIELD_NAMES = new Set<string>([...SYSTEM_FIELDS, "type", "data"]);

const fieldDefSchema: z.ZodType<FieldDef> = z
  .object({
    name: z.string().regex(FIELD_NAME_RE, "field names are camelCase/snake_case, starting with a lowercase letter"),
    label: z.string().min(1).optional(),
    kind: z.enum([
      "text",
      "richtext",
      "number",
      "boolean",
      "date",
      "select",
      "json",
      "reference",
      "media",
    ]),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    indexed: z.boolean().optional(),
    options: z.array(z.string().min(1)).min(1).optional(),
    ref: z.string().regex(TYPE_NAME_RE).optional(),
    default: z.unknown().optional(),
  })
  .strict();

export const contentTypeInputSchema: z.ZodType<ContentTypeInput> = z
  .object({
    name: z.string().regex(TYPE_NAME_RE, "type names are lowercase snake_case"),
    label: z.string().min(1),
    description: z.string().optional(),
    fields: z.array(fieldDefSchema),
  })
  .strict();

function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

/** Validate a content type definition beyond raw shape: names, kinds, cross-field rules. */
export function validateContentTypeInput(input: unknown): ContentTypeInput {
  const parsed = contentTypeInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("invalid content type definition", zodIssues(parsed.error));
  }
  const def = parsed.data;
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  for (const f of def.fields) {
    if (RESERVED_FIELD_NAMES.has(f.name)) {
      issues.push({ path: `fields.${f.name}`, message: `"${f.name}" is a reserved field name` });
    }
    if (seen.has(f.name)) {
      issues.push({ path: `fields.${f.name}`, message: "duplicate field name" });
    }
    seen.add(f.name);
    if (f.kind === "select" && (!f.options || f.options.length === 0)) {
      issues.push({ path: `fields.${f.name}`, message: 'kind "select" requires options' });
    }
    if (f.kind === "reference" && !f.ref) {
      issues.push({ path: `fields.${f.name}`, message: 'kind "reference" requires ref' });
    }
    if (f.unique && f.kind === "json") {
      issues.push({ path: `fields.${f.name}`, message: 'kind "json" cannot be unique' });
    }
  }
  if (issues.length > 0) throw new ValidationError("invalid content type definition", issues);
  return def;
}

const ISO_DATE = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), "must be an ISO-8601 date string");

function fieldSchema(f: FieldDef): z.ZodTypeAny {
  switch (f.kind) {
    case "text":
    case "richtext":
      return z.string();
    case "number":
      return z.number().finite();
    case "boolean":
      return z.boolean();
    case "date":
      return ISO_DATE;
    case "select":
      return z.enum(f.options as [string, ...string[]]);
    case "json":
      return z.unknown();
    case "reference":
      return z.string().min(1); // target entry id
    case "media":
      return z.string().min(1); // storage key
  }
}

/**
 * Build the Zod validator for an entry payload from its content type.
 * Unknown keys are rejected: the definition is the contract.
 */
export function buildEntrySchema(def: ContentTypeInput): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of def.fields) {
    let s = fieldSchema(f);
    if (!f.required) {
      s = s.nullish();
    } else if (f.kind === "json") {
      // z.unknown() accepts undefined, which makes the key optional inside
      // z.object and silently defeats `required` for json fields.
      s = s.refine((v) => v !== undefined, { message: "Required" });
    }
    shape[f.name] = s;
  }
  return z.object(shape).strict() as unknown as z.ZodType<Record<string, unknown>>;
}

/** Validate entry data against a type, returning normalized data or throwing ValidationError. */
export function validateEntryData(
  def: ContentTypeInput,
  data: Record<string, unknown>
): Record<string, unknown> {
  const withDefaults: Record<string, unknown> = { ...data };
  for (const f of def.fields) {
    if (withDefaults[f.name] === undefined && f.default !== undefined) {
      withDefaults[f.name] = f.default;
    }
  }
  const parsed = buildEntrySchema(def).safeParse(withDefaults);
  if (!parsed.success) {
    throw new ValidationError("invalid entry data", zodIssues(parsed.error));
  }
  return parsed.data;
}
