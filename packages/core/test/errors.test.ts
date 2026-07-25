import { describe, expect, test } from "bun:test";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  OpenCMSError,
  UnauthorizedError,
  ValidationError,
} from "@opencms/core";

/**
 * The error contract is load-bearing: the API maps `code` to HTTP status, so a
 * renamed code is a silent behaviour change for every client.
 */
describe("errors", () => {
  test("every error carries a stable code and name", () => {
    const cases = [
      { err: new NotFoundError("nope"), code: "not_found", name: "NotFoundError" },
      { err: new ConflictError("clash"), code: "conflict", name: "ConflictError" },
      { err: new ValidationError("bad"), code: "validation", name: "ValidationError" },
      { err: new UnauthorizedError(), code: "unauthorized", name: "UnauthorizedError" },
      { err: new ForbiddenError(), code: "forbidden", name: "ForbiddenError" },
    ];
    for (const { err, code, name } of cases) {
      expect(err.code).toBe(code);
      expect(err.name).toBe(name);
      expect(err).toBeInstanceOf(OpenCMSError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  test("UnauthorizedError and ForbiddenError have sensible default messages", () => {
    expect(new UnauthorizedError().message).toBe("authentication required");
    expect(new ForbiddenError().message).toBe("insufficient role");
    expect(new UnauthorizedError("custom").message).toBe("custom");
    expect(new ForbiddenError("custom").message).toBe("custom");
  });

  test("ValidationError carries structured issues, defaulting to none", () => {
    const bare = new ValidationError("bad");
    expect(bare.issues).toEqual([]);

    const withIssues = new ValidationError("bad", [
      { path: "title", message: "Required" },
      { path: "views", message: "Expected number" },
    ]);
    expect(withIssues.issues).toHaveLength(2);
    expect(withIssues.issues[0]).toEqual({ path: "title", message: "Required" });
  });

  test("errors are catchable as OpenCMSError and discriminated by code", () => {
    const thrower = () => {
      throw new ConflictError("clash");
    };
    try {
      thrower();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OpenCMSError);
      expect((err as OpenCMSError).code).toBe("conflict");
    }
  });
});
