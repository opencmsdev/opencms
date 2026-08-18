import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { BUNX_SETUP } from "./commands.ts";
import { assertInitConfig, type InitConfig } from "./config.ts";

/**
 * Load `opencms.config.ts` as a live module so factory `setup` methods stay
 * attached. JSON round-tripping would strip them. Needs Bun (or another
 * loader that can import TypeScript).
 */
export async function loadConfig(cwd: string): Promise<InitConfig> {
  const file = resolve(cwd, "opencms.config.ts");
  if (!existsSync(file)) {
    throw new Error(`No opencms.config.ts in ${cwd}. Run \`opencms init\` first.`);
  }
  try {
    const mod = (await import(pathToFileURL(file).href)) as { default: unknown };
    return assertInitConfig(mod.default);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("opencms.config.ts")) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Could not load opencms.config.ts (${reason}). Run \`${BUNX_SETUP}\` so Bun can import the TypeScript config.`,
    );
  }
}
