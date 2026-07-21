import { describe, expect, test } from "bun:test";
import {
  validateContentTypeInput,
  validateEntryData,
  ValidationError,
  slugify,
  isValidSlug,
} from "@opencms/core";

const article = {
  name: "article",
  label: "Article",
  fields: [
    { name: "title", kind: "text" as const, required: true },
    { name: "body", kind: "richtext" as const },
    { name: "views", kind: "number" as const, indexed: true },
    { name: "category", kind: "select" as const, options: ["tech", "life"] },
    { name: "publishedOn", kind: "date" as const },
    { name: "featured", kind: "boolean" as const, default: false },
  ],
};

describe("content type validation", () => {
  test("accepts a valid definition", () => {
    expect(validateContentTypeInput(article).name).toBe("article");
  });

  test("rejects reserved field names", () => {
    expect(() =>
      validateContentTypeInput({
        name: "x",
        label: "X",
        fields: [{ name: "id", kind: "text" }],
      })
    ).toThrow(ValidationError);
  });

  test("rejects duplicate field names", () => {
    expect(() =>
      validateContentTypeInput({
        name: "x",
        label: "X",
        fields: [
          { name: "a", kind: "text" },
          { name: "a", kind: "number" },
        ],
      })
    ).toThrow(ValidationError);
  });

  test("select requires options, reference requires ref", () => {
    expect(() =>
      validateContentTypeInput({ name: "x", label: "X", fields: [{ name: "s", kind: "select" }] })
    ).toThrow(ValidationError);
    expect(() =>
      validateContentTypeInput({
        name: "x",
        label: "X",
        fields: [{ name: "r", kind: "reference" }],
      })
    ).toThrow(ValidationError);
  });

  test("rejects bad type names", () => {
    expect(() =>
      validateContentTypeInput({ name: "Bad Name", label: "X", fields: [] })
    ).toThrow(ValidationError);
  });
});

describe("entry data validation", () => {
  test("valid data passes and defaults apply", () => {
    const data = validateEntryData(article, { title: "Hello", views: 3 });
    expect(data.featured).toBe(false);
    expect(data.title).toBe("Hello");
  });

  test("missing required field fails", () => {
    expect(() => validateEntryData(article, { body: "no title" })).toThrow(ValidationError);
  });

  test("wrong kinds fail", () => {
    expect(() => validateEntryData(article, { title: "x", views: "many" })).toThrow(
      ValidationError
    );
    expect(() => validateEntryData(article, { title: "x", category: "nope" })).toThrow(
      ValidationError
    );
    expect(() => validateEntryData(article, { title: "x", publishedOn: "not a date" })).toThrow(
      ValidationError
    );
  });

  test("unknown keys are rejected", () => {
    expect(() => validateEntryData(article, { title: "x", nope: 1 })).toThrow(ValidationError);
  });
});

describe("slugs", () => {
  test("slugify normalizes", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("Écran Génial")).toBe("ecran-genial");
    expect(slugify("   ")).toBe("entry");
  });

  test("isValidSlug", () => {
    expect(isValidSlug("a-b-c")).toBe(true);
    expect(isValidSlug("A-b")).toBe(false);
    expect(isValidSlug("a--b")).toBe(false);
    expect(isValidSlug("-a")).toBe(false);
  });
});
