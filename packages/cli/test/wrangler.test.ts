import { describe, expect, test } from "bun:test";
import { isLoggedIn, parseAccountId, parseD1List, parseDatabaseId } from "../src/wrangler.ts";

describe("parseDatabaseId", () => {
  test("reads a wrangler d1 create snippet", () => {
    const out = `[[d1_databases]]\nbinding = "DB"\ndatabase_name = "opencms"\ndatabase_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"\n`;
    expect(parseDatabaseId(out)).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  test("reads json", () => {
    expect(parseDatabaseId('{"uuid":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}')).toBe(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    );
  });
});

describe("parseD1List", () => {
  test("maps uuid or id", () => {
    expect(
      parseD1List(
        `[{"uuid":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","name":"opencms"},{"id":"bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee","name":"other"}]`,
      ),
    ).toEqual([
      { name: "opencms", id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      { name: "other", id: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee" },
    ]);
  });
});

describe("parseAccountId", () => {
  test("picks a 32-char hex account id out of whoami text", () => {
    expect(parseAccountId("Account ID\n  abcdef0123456789abcdef0123456789\n")).toBe(
      "abcdef0123456789abcdef0123456789",
    );
  });
});

describe("isLoggedIn", () => {
  test("nonzero or not-logged-in copy is false", () => {
    expect(isLoggedIn({ status: 1, stdout: "", stderr: "not logged in" })).toBe(false);
    expect(isLoggedIn({ status: 0, stdout: "not currently logged in", stderr: "" })).toBe(false);
    expect(isLoggedIn({ status: 0, stdout: "You are logged in", stderr: "" })).toBe(true);
  });
});
