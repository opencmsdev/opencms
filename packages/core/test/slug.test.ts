import { describe, expect, test } from "bun:test";
import { isValidSlug, slugify } from "@opencms/core";

describe("slugify", () => {
  test("collapses runs of separators into a single hyphen", () => {
    expect(slugify("a   ---  b")).toBe("a-b");
    expect(slugify("Hello,,,   World!!!")).toBe("hello-world");
  });

  test("keeps digits and strips everything else", () => {
    expect(slugify("Top 10 Things (2026)")).toBe("top-10-things-2026");
  });

  test("falls back to 'entry' when nothing survives", () => {
    expect(slugify("")).toBe("entry");
    expect(slugify("   ")).toBe("entry");
    expect(slugify("!!!")).toBe("entry");
    expect(slugify("...---...")).toBe("entry");
  });

  test("truncates to 80 characters", () => {
    expect(slugify("a".repeat(200)).length).toBe(80);
  });

  test("truncation never leaves a trailing hyphen", () => {
    // Regression: trimming before slicing let the cut land mid-separator and
    // produced a slug that isValidSlug rejects, so EntryService.create threw
    // on an ordinary long title.
    const title = `${"a".repeat(79)} b`;
    const slug = slugify(title);
    expect(slug.endsWith("-")).toBe(false);
    expect(isValidSlug(slug)).toBe(true);
  });

  test("every slugify output is a valid slug", () => {
    const inputs = [
      "Hello, World!",
      "Écran Génial",
      "   ",
      "!!!",
      "a".repeat(200),
      `${"a".repeat(79)} b`,
      `${"word ".repeat(40)}`,
      "-leading and trailing-",
      "MiXeD CaSe 123",
    ];
    for (const input of inputs) {
      expect(isValidSlug(slugify(input))).toBe(true);
    }
  });
});

describe("isValidSlug", () => {
  test("rejects trailing hyphens, empties and underscores", () => {
    expect(isValidSlug("a-")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("a_b")).toBe(false);
    expect(isValidSlug("a b")).toBe(false);
  });

  test("enforces the 120 character ceiling", () => {
    expect(isValidSlug("a".repeat(120))).toBe(true);
    expect(isValidSlug("a".repeat(121))).toBe(false);
  });

  test("accepts digits-only and single-character slugs", () => {
    expect(isValidSlug("2026")).toBe(true);
    expect(isValidSlug("a")).toBe(true);
  });
});
