/**
 * Small wrangler.toml patches. No TOML parser: the file we ship is simple,
 * and a full parser would be a new dependency in a package that otherwise
 * uses only node builtins.
 */

const PLACEHOLDER_D1 = "REPLACE_WITH_YOUR_DATABASE_ID";

export function isPlaceholderDatabaseId(id: string | undefined): boolean {
  return id === undefined || id === "" || id === PLACEHOLDER_D1;
}

/** First uncommented `database_id = "..."` in the file. */
export function readDatabaseId(toml: string): string | undefined {
  const match = /^database_id = "([^"]*)"$/m.exec(toml);
  return match?.[1];
}

export function setDatabaseId(toml: string, id: string): string {
  if (/^database_id = "/m.test(toml)) {
    return toml.replace(/^database_id = ".*"$/m, `database_id = "${id}"`);
  }
  return toml.replace(/\s*$/, "") + `\n\ndatabase_id = "${id}"\n`;
}

export function setWorkerName(toml: string, name: string): string {
  return toml.replace(/^name = ".*"$/m, `name = "${name}"`);
}

export function setDatabaseName(toml: string, name: string): string {
  return toml.replace(/^database_name = ".*"$/m, `database_name = "${name}"`);
}

/**
 * Uncommented `[vars]` body, or null if the file has none. Commented
 * `# [vars]` blocks (the shipped wrangler.toml) are ignored.
 */
function varsBlockRange(toml: string): { start: number; end: number } | null {
  const lines = toml.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() === "[vars]") {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t.startsWith("[") && !t.startsWith("#")) {
      end = i;
      break;
    }
  }
  return { start, end };
}

export function upsertVars(toml: string, vars: Record<string, string>): string {
  const entries = Object.entries(vars).filter(([, value]) => value !== "");
  if (entries.length === 0) return toml;
  const lines = toml.split("\n");
  // Preserve a trailing newline by dropping the last empty split piece.
  const trailing = lines.length > 0 && lines[lines.length - 1] === "";
  if (trailing) lines.pop();

  const range = varsBlockRange(lines.join("\n"));
  if (range === null) {
    lines.push("", "[vars]");
    for (const [key, value] of entries) lines.push(`${key} = "${value}"`);
    return lines.join("\n") + "\n";
  }

  const pending = new Map(entries);
  const rebuilt: string[] = [];
  for (let i = range.start + 1; i < range.end; i++) {
    const line = lines[i]!;
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*"(.*)"\s*$/.exec(line);
    if (!match) {
      rebuilt.push(line);
      continue;
    }
    const key = match[1]!;
    const next = pending.get(key);
    if (next === undefined) {
      rebuilt.push(line);
      continue;
    }
    pending.delete(key);
    rebuilt.push(`${key} = "${next}"`);
  }
  for (const [key, value] of pending) rebuilt.push(`${key} = "${value}"`);

  const out = [...lines.slice(0, range.start + 1), ...rebuilt, ...lines.slice(range.end)];
  return out.join("\n") + "\n";
}

export function upsertCustomDomain(toml: string, domain: string): string {
  if (toml.includes(`pattern = "${domain}"`)) return toml;
  return toml.replace(/\s*$/, "") + `\n\n[[routes]]\npattern = "${domain}"\ncustom_domain = true\n`;
}
