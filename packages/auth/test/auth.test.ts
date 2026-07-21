import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createAuth, isRole, runAuthMigrations } from "./../src/index.ts";

function makeAuth() {
  return createAuth({
    database: new Database(":memory:"),
    secret: "test-secret-not-for-production-0123456789",
    baseURL: "http://localhost",
  });
}

describe("createAuth", () => {
  test("refuses to run without a secret", () => {
    expect(() =>
      createAuth({ database: new Database(":memory:"), secret: "" })
    ).toThrow(/secret/);
  });

  test("migrations are idempotent", async () => {
    const auth = makeAuth();
    await runAuthMigrations(auth);
    await runAuthMigrations(auth);
  });

  test("the first signup gets the admin role", async () => {
    const auth = makeAuth();
    await runAuthMigrations(auth);

    const res = await auth.handler(
      new Request("http://localhost/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "first@opencms.test",
          password: "password-123456",
          name: "First",
        }),
      })
    );
    expect(res.status).toBe(200);

    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user.email).toBe("first@opencms.test");
    expect((session?.user as { role?: string }).role).toBe("admin");
  });
});

describe("isRole", () => {
  test("accepts the two roles and nothing else", () => {
    expect(isRole("admin")).toBe(true);
    expect(isRole("editor")).toBe(true);
    expect(isRole("superuser")).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });
});
