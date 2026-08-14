/**
 * `.env` upsert: keep comments and unrelated keys, never clobber a secret
 * that is already set unless the caller asks.
 */
export function parseEnv(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

export function upsertEnv(
  source: string,
  updates: Record<string, string | undefined>,
  opts: { overwrite?: boolean } = {},
): string {
  const overwrite = opts.overwrite === true;
  const pending = new Map(
    Object.entries(updates).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const lines = source === "" ? [] : source.split("\n");
  // Drop a trailing empty line so we can re-terminate cleanly.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || !trimmed.includes("=")) {
      out.push(line);
      continue;
    }
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq);
    const current = trimmed.slice(eq + 1);
    const next = pending.get(key);
    if (next === undefined) {
      out.push(line);
      continue;
    }
    pending.delete(key);
    out.push(!overwrite && current !== "" ? line : `${key}=${next}`);
  }
  for (const [key, value] of pending) out.push(`${key}=${value}`);
  return out.join("\n") + "\n";
}
