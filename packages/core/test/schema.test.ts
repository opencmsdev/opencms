import { describe, expect, test } from "bun:test";
import {
  buildEntrySchema,
  ValidationError,
  validateContentTypeInput,
  validateEntryData,
} from "@opencms/core";
import type { ContentTypeInput } from "@opencms/core";

/** Minimal single-field type builder, so each test states only what it cares about. */
function typeWith(...fields: ContentTypeInput["fields"]): ContentTypeInput {
  return { name: "thing", label: "Thing", fields };
}

/** Collect the issues off a ValidationError without losing the type. */
function issuesOf(fn: () => unknown): { path: string; message: string }[] {
  try {
    fn();
  } catch (err) {
    if (err instanceof ValidationError) return err.issues;
    throw err;
  }
  throw new Error("expected a ValidationError");
}

describe("validateContentTypeInput: shape", () => {
  test("rejects unknown keys at the type level", () => {
    expect(() =>
      validateContentTypeInput({ name: "a", label: "A", fields: [], extra: true })
    ).toThrow(ValidationError);
  });

  test("rejects unknown keys inside a field", () => {
    expect(() =>
      validateContentTypeInput({
        name: "a",
        label: "A",
        fields: [{ name: "t", kind: "text", nope: 1 }],
      })
    ).toThrow(ValidationError);
  });

  test("requires a non-empty label", () => {
    expect(() => validateContentTypeInput({ name: "a", label: "", fields: [] })).toThrow(
      ValidationError
    );
    expect(() => validateContentTypeInput({ name: "a", fields: [] })).toThrow(ValidationError);
  });

  test("requires a fields array", () => {
    expect(() => validateContentTypeInput({ name: "a", label: "A" })).toThrow(ValidationError);
  });

  test("accepts a type with no fields", () => {
    const def = validateContentTypeInput({ name: "empty", label: "Empty", fields: [] });
    expect(def.fields).toEqual([]);
  });

  test.each([["Article"], ["1article"], ["my-type"], ["my type"], ["a".repeat(65)]])(
    "rejects the type name %p",
    (name) => {
      expect(() => validateContentTypeInput({ name, label: "X", fields: [] })).toThrow(
        ValidationError
      );
    }
  );

  test.each([["Title"], ["1x"], ["a-b"], ["a b"], [""]])(
    "rejects the field name %p",
    (name) => {
      expect(() =>
        validateContentTypeInput({ name: "a", label: "A", fields: [{ name, kind: "text" }] })
      ).toThrow(ValidationError);
    }
  );

  test("accepts camelCase and snake_case field names", () => {
    const def = validateContentTypeInput({
      name: "a",
      label: "A",
      fields: [
        { name: "publishedOn", kind: "date" },
        { name: "hero_image", kind: "media" },
      ],
    });
    expect(def.fields.map((f) => f.name)).toEqual(["publishedOn", "hero_image"]);
  });

  test("rejects an unknown field kind", () => {
    expect(() =>
      validateContentTypeInput({ name: "a", label: "A", fields: [{ name: "x", kind: "colour" }] })
    ).toThrow(ValidationError);
  });

  test("rejects empty select options at the schema layer", () => {
    expect(() =>
      validateContentTypeInput({
        name: "a",
        label: "A",
        fields: [{ name: "x", kind: "select", options: [] }],
      })
    ).toThrow(ValidationError);
    expect(() =>
      validateContentTypeInput({
        name: "a",
        label: "A",
        fields: [{ name: "x", kind: "select", options: [""] }],
      })
    ).toThrow(ValidationError);
  });
});

describe("validateContentTypeInput: cross-field rules", () => {
  test.each([
    ["id"],
    ["slug"],
    ["status"],
    ["createdAt"],
    ["updatedAt"],
    ["publishedAt"],
    ["type"],
    ["data"],
  ])("rejects the reserved field name %p", (name) => {
    const issues = issuesOf(() =>
      validateContentTypeInput({ name: "a", label: "A", fields: [{ name, kind: "text" }] })
    );
    expect(issues).toContainEqual({
      path: `fields.${name}`,
      message: `"${name}" is a reserved field name`,
    });
  });

  test("rejects a unique json field", () => {
    const issues = issuesOf(() =>
      validateContentTypeInput({
        name: "a",
        label: "A",
        fields: [{ name: "blob", kind: "json", unique: true }],
      })
    );
    expect(issues).toContainEqual({
      path: "fields.blob",
      message: 'kind "json" cannot be unique',
    });
  });

  test("accumulates every cross-field problem into one error", () => {
    const issues = issuesOf(() =>
      validateContentTypeInput({
        name: "a",
        label: "A",
        fields: [
          { name: "id", kind: "text" },
          { name: "choice", kind: "select" },
          { name: "author", kind: "reference" },
          { name: "choice", kind: "text" },
        ],
      })
    );
    expect(issues.length).toBeGreaterThan(3);
    const messages = issues.map((i) => i.message);
    expect(messages).toContain('"id" is a reserved field name');
    expect(messages).toContain('kind "select" requires options');
    expect(messages).toContain('kind "reference" requires ref');
    expect(messages).toContain("duplicate field name");
  });
});

describe("buildEntrySchema: per-kind rules", () => {
  test("number rejects NaN and Infinity", () => {
    const schema = buildEntrySchema(typeWith({ name: "n", kind: "number", required: true }));
    expect(schema.safeParse({ n: 1.5 }).success).toBe(true);
    expect(schema.safeParse({ n: Number.NaN }).success).toBe(false);
    expect(schema.safeParse({ n: Number.POSITIVE_INFINITY }).success).toBe(false);
  });

  test("boolean rejects the string 'true'", () => {
    const schema = buildEntrySchema(typeWith({ name: "b", kind: "boolean", required: true }));
    expect(schema.safeParse({ b: true }).success).toBe(true);
    expect(schema.safeParse({ b: "true" }).success).toBe(false);
  });

  test("reference and media reject the empty string", () => {
    const schema = buildEntrySchema(
      typeWith(
        { name: "author", kind: "reference", ref: "person", required: true },
        { name: "hero", kind: "media", required: true }
      )
    );
    expect(schema.safeParse({ author: "abc", hero: "uploads/a.png" }).success).toBe(true);
    expect(schema.safeParse({ author: "", hero: "uploads/a.png" }).success).toBe(false);
    expect(schema.safeParse({ author: "abc", hero: "" }).success).toBe(false);
  });

  test("json accepts arbitrary nested structures", () => {
    const schema = buildEntrySchema(typeWith({ name: "blob", kind: "json" }));
    const value = { a: [1, { b: null }], c: "d" };
    const parsed = schema.safeParse({ blob: value });
    expect(parsed.success).toBe(true);
  });

  test("a required json field is actually required", () => {
    // Regression: z.unknown() accepts undefined, which made the key optional
    // inside z.object and silently defeated `required`.
    const schema = buildEntrySchema(typeWith({ name: "blob", kind: "json", required: true }));
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ blob: null }).success).toBe(true);
    expect(schema.safeParse({ blob: 0 }).success).toBe(true);
  });

  test("optional fields accept null and undefined; required ones do not accept null", () => {
    const optional = buildEntrySchema(typeWith({ name: "t", kind: "text" }));
    expect(optional.safeParse({ t: null }).success).toBe(true);
    expect(optional.safeParse({ t: undefined }).success).toBe(true);
    expect(optional.safeParse({}).success).toBe(true);

    const required = buildEntrySchema(typeWith({ name: "t", kind: "text", required: true }));
    expect(required.safeParse({ t: null }).success).toBe(false);
    expect(required.safeParse({}).success).toBe(false);
  });

  test("select accepts only declared options", () => {
    const schema = buildEntrySchema(
      typeWith({ name: "c", kind: "select", options: ["news", "opinion"], required: true })
    );
    expect(schema.safeParse({ c: "news" }).success).toBe(true);
    expect(schema.safeParse({ c: "News" }).success).toBe(false);
  });

  test("date accepts anything Date.parse understands", () => {
    const schema = buildEntrySchema(typeWith({ name: "d", kind: "date", required: true }));
    expect(schema.safeParse({ d: "2026-07-25T09:30:00.000Z" }).success).toBe(true);
    expect(schema.safeParse({ d: "not a date" }).success).toBe(false);
  });
});

describe("validateEntryData: defaults", () => {
  const def = typeWith(
    { name: "n", kind: "number", default: 7 },
    { name: "flag", kind: "boolean", default: false },
    { name: "note", kind: "text", default: "" },
    { name: "count", kind: "number", default: 0 }
  );

  test("applies defaults for absent keys", () => {
    expect(validateEntryData(def, {})).toEqual({ n: 7, flag: false, note: "", count: 0 });
  });

  test("applies falsy defaults rather than skipping them", () => {
    const out = validateEntryData(def, {});
    expect(out.flag).toBe(false);
    expect(out.note).toBe("");
    expect(out.count).toBe(0);
  });

  test("an explicit null defeats the default", () => {
    // The guard is `=== undefined`, so a caller can deliberately store null.
    expect(validateEntryData(def, { n: null }).n).toBeNull();
  });

  test("an explicit value wins over the default", () => {
    expect(validateEntryData(def, { n: 1 }).n).toBe(1);
  });

  test("returns the parsed object, not the caller's input", () => {
    const input = { n: 1 };
    const out = validateEntryData(def, input);
    expect(out).not.toBe(input);
  });

  test("rejects unknown keys", () => {
    expect(() => validateEntryData(def, { nope: 1 })).toThrow(ValidationError);
  });

  test("failures carry per-field issues", () => {
    const issues = issuesOf(() =>
      validateEntryData(typeWith({ name: "t", kind: "text", required: true }), {})
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]?.path).toBe("t");
  });
});
