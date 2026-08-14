/**
 * `opencms setup`: load opencms.config.ts and ask each integration to set
 * itself up, then `test` the connection. This file does not know what D1
 * or S3 are; it only walks `plan` / `setup` / `test` on whatever the
 * factories returned.
 */
import type { InitConfig } from "./config.ts";
import { palette } from "./io.ts";
import { confirm } from "./prompts.ts";
import { generateSecret } from "./scaffold.ts";
import {
  isIntegration,
  type Integration,
  type SetupContext,
} from "./setup-context.ts";

export type { SetupContext } from "./setup-context.ts";

export interface SetupResult {
  ok: boolean;
  error?: string;
}

function integrationsOf(config: InitConfig): Integration[] {
  const candidates: unknown[] = [config.backend, config.storage, config.cache, config.frontend];
  return candidates.filter(isIntegration);
}

export async function runSetup(
  config: InitConfig,
  ctx: Omit<SetupContext, "generateSecret"> & { generateSecret?: () => string },
): Promise<SetupResult> {
  const c = palette(ctx.io.colorEnabled);
  const full: SetupContext = {
    ...ctx,
    generateSecret: ctx.generateSecret ?? generateSecret,
  };
  const items = integrationsOf(config);

  ctx.io.write(`\n${c.bold("OpenCMS setup")}\n`);
  ctx.io.write(c.dim("Each integration in opencms.config.ts sets itself up, then tests the connection. Safe to re-run.\n\n"));
  ctx.io.write("Will:\n");
  for (const item of items) {
    for (const step of item.plan()) ctx.io.write(`  - ${step}\n`);
  }

  if (!ctx.yes) {
    const ok = await confirm(ctx.io, "Continue?", true);
    if (!ok) {
      ctx.io.write("Nothing changed.\n");
      return { ok: true };
    }
  }

  try {
    for (const item of items) {
      await item.setup(full);
      await item.test(full);
    }
    ctx.io.write(`\n${c.green("✔")} Setup complete.\n`);
    const next = config.backend.nextSteps?.();
    if (next) ctx.io.write(`Next: ${c.bold(next)}\n`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
