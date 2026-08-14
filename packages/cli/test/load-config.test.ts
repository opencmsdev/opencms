import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/load-config.ts";

describe("loadConfig", () => {
  test("missing file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencms-noconfig-"));
    await expect(loadConfig(dir)).rejects.toThrow("No opencms.config.ts");
  });

  test("loads a typed config module with setup methods attached", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opencms-cfg-"));
    const factories = new URL("../src/config.ts", import.meta.url).href;
    writeFileSync(
      join(dir, "opencms.config.ts"),
      `import { defineConfig, bunSqlite } from ${JSON.stringify(factories)};
export default defineConfig({
  projectName: "from-file",
  adminEmail: "a@b.co",
  adminName: "A",
  backend: bunSqlite({ publicUrl: "http://localhost:3000", port: 3000, dbPath: "x.db" }),
});
`,
    );
    const config = await loadConfig(dir);
    expect(config.projectName).toBe("from-file");
    expect(config.backend.kind).toBe("bun-sqlite");
    expect(typeof config.backend.setup).toBe("function");
    expect(typeof config.backend.test).toBe("function");
  });
});
