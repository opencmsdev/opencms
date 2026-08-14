/**
 * Wrangler subprocess + parsers. The CLI never imports `bun:*`; it shells
 * out to `bunx wrangler` (then `npx wrangler`) so `npx opencms setup` still
 * works on a machine that has Node and wrangler.
 */
import { spawnSync } from "node:child_process";

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  input?: string;
  /** OAuth / login flows need a real TTY. */
  inherit?: boolean;
}

export type Run = (command: string, args: string[], opts?: RunOptions) => CommandResult;

export function createRun(): Run {
  return (command, args, opts = {}) => {
    if (opts.inherit) {
      const result = spawnSync(command, args, {
        cwd: opts.cwd,
        input: opts.input,
        stdio: "inherit",
        encoding: "utf8",
      });
      return { status: result.status ?? 1, stdout: "", stderr: "" };
    }
    const result = spawnSync(command, args, {
      cwd: opts.cwd,
      input: opts.input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      ...(result.error ? { stderr: result.error.message } : {}),
    };
  };
}

export function parseDatabaseId(output: string): string | undefined {
  const json = tryJson(output);
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const rec = json as Record<string, unknown>;
    const id = rec.uuid ?? rec.id ?? rec.database_id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  const match = /database_id\s*=\s*"([0-9a-f-]{36})"/i.exec(output);
  return match?.[1];
}

export interface D1Entry {
  name: string;
  id: string;
}

export function parseD1List(output: string): D1Entry[] {
  const json = tryJson(output);
  if (!Array.isArray(json)) return [];
  const entries: D1Entry[] = [];
  for (const item of json) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const name = rec.name;
    const id = rec.uuid ?? rec.id ?? rec.database_id;
    if (typeof name === "string" && typeof id === "string") entries.push({ name, id });
  }
  return entries;
}

export function parseAccountId(output: string): string | undefined {
  const json = tryJson(output);
  if (json && typeof json === "object" && !Array.isArray(json)) {
    const rec = json as Record<string, unknown>;
    const accounts = rec.accounts;
    if (Array.isArray(accounts) && accounts[0] && typeof accounts[0] === "object") {
      const id = (accounts[0] as Record<string, unknown>).id;
      if (typeof id === "string") return id;
    }
    if (typeof rec.account_id === "string") return rec.account_id;
  }
  const hex = /\b([a-f0-9]{32})\b/i.exec(output);
  return hex?.[1];
}

export function isLoggedIn(result: CommandResult): boolean {
  if (result.status !== 0) return false;
  const text = `${result.stdout}\n${result.stderr}`;
  return !/not (currently )?logged in|not authenticated/i.test(text);
}

function tryJson(output: string): unknown {
  const obj = output.indexOf("{");
  const arr = output.indexOf("[");
  const start = obj === -1 ? arr : arr === -1 ? obj : Math.min(obj, arr);
  if (start < 0) return undefined;
  try {
    return JSON.parse(output.slice(start));
  } catch {
    return undefined;
  }
}

/** Prefer bunx, then npx, so both bunx opencms and npx opencms work. */
export function wranglerInvocation(
  run: Run,
  args: string[],
  opts?: RunOptions,
): CommandResult {
  const bunx = run("bunx", ["wrangler", ...args], opts);
  if (bunx.status === 0 || bunx.status === null) return bunx;
  // bunx missing: fall back. A wrangler failure (nonzero) is still wrangler.
  if (/not found|ENOENT/i.test(bunx.stderr)) {
    return run("npx", ["--yes", "wrangler", ...args], opts);
  }
  return bunx;
}
