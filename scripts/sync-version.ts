#!/usr/bin/env bun
/**
 * Propagates the root package.json version to every place that declares or
 * displays it.
 *
 *   bun run sync:version           # write
 *   bun run sync:version --check   # exit 1 if anything is stale, for CI
 *
 * There is exactly one source of truth, the root `package.json`, and
 * everything else is derived. The alternative, a version string typed into a
 * dozen files, fails the same way every time: the tag says 0.3.0 and the
 * running app still says 0.1.0, and nobody notices until a bug report quotes
 * the wrong number.
 *
 * `packages/core/src/version.ts` is generated and committed rather than read
 * from package.json at runtime, because the API also runs on Cloudflare
 * Workers where there is no filesystem to read it from.
 */
export {}; // top-level await needs this file to be a module

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const check = process.argv.includes("--check");

const root = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
const version: string = root.version;
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  throw new Error(`root package.json version is not semver: ${version}`);
}

const stale: string[] = [];

async function write(path: string, contents: string): Promise<void> {
  const before = await readFile(path, "utf8").catch(() => null);
  if (before === contents) return;
  stale.push(path.replace(`${ROOT}/`, ""));
  if (!check) await writeFile(path, contents, "utf8");
}

// Every workspace package carries the same version: nothing here publishes
// independently, so independent version numbers would be bookkeeping with no
// benefit. Revisit if a package ever releases on its own schedule.
for (const dir of ["packages", "apps"]) {
  for (const name of await readdir(join(ROOT, dir))) {
    const path = join(ROOT, dir, name, "package.json");
    const raw = await readFile(path, "utf8").catch(() => null);
    if (!raw) continue;
    const pkg = JSON.parse(raw);
    if (pkg.version === version) continue;
    pkg.version = version;
    await write(path, `${JSON.stringify(pkg, null, 2)}\n`);
  }
}

await write(
  join(ROOT, "packages/core/src/version.ts"),
  `/**
 * GENERATED FILE. Rewritten by \`bun run sync:version\`. Do not edit by hand.
 *
 * Mirrors the root package.json version so the API can report it at runtime,
 * including on Workers where package.json cannot be read.
 */

export const VERSION = ${JSON.stringify(version)};
`
);

if (check) {
  console.log(
    stale.length
      ? `sync:version  ${stale.length} file(s) out of date with ${version}:\n  ${stale.join("\n  ")}\nRun \`bun run sync:version\` and commit.`
      : `sync:version  everything matches ${version}.`
  );
  process.exit(stale.length ? 1 : 0);
}

console.log(
  stale.length
    ? `sync:version  wrote ${version} to ${stale.length} file(s):\n  ${stale.join("\n  ")}`
    : `sync:version  everything already matches ${version}.`
);
