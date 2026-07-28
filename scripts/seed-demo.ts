/**
 * Seed a fresh OpenCMS instance with demo content.
 *
 *   bun run scripts/seed-demo.ts
 *   OPENCMS_URL=https://opencms-api.example.workers.dev \
 *   OPENCMS_EMAIL=demo@example.com OPENCMS_PASSWORD='...' \
 *     bun run scripts/seed-demo.ts
 *
 * Safe to re-run: content types that already exist are left alone, and
 * entries are matched by slug so a second run updates rather than duplicates.
 *
 * On a database with no users this performs the bootstrap signup, which is
 * what makes the account an admin. On a database that already has one it
 * signs in instead, so pointing it at a live instance will not lock you out.
 */
export {}; // top-level await needs this file to be a module

const BASE = (process.env.OPENCMS_URL ?? "http://localhost:3000").replace(/\/$/, "");
const EMAIL = process.env.OPENCMS_EMAIL ?? "demo@opencms.local";
const PASSWORD = process.env.OPENCMS_PASSWORD ?? "demo-password-123456";

let cookie = "";

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  // better-auth enforces CSRF on its own routes, so cookie-authenticated
  // calls from outside a browser have to present a matching Origin.
  headers.set("origin", BASE);
  if (cookie) headers.set("cookie", cookie);
  return fetch(`${BASE}${path}`, { ...init, headers });
}

function captureCookie(res: Response): void {
  const set = res.headers.getSetCookie();
  if (set.length) cookie = set.map((c) => c.split(";")[0]).join("; ");
}

async function authenticate(): Promise<void> {
  const setup = await call("/api/setup").then((r) => r.json() as Promise<{ needsSetup: boolean }>);

  const path = setup.needsSetup ? "/api/auth/sign-up/email" : "/api/auth/sign-in/email";
  const body = setup.needsSetup
    ? { email: EMAIL, password: PASSWORD, name: "Demo" }
    : { email: EMAIL, password: PASSWORD };

  const res = await call(path, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    throw new Error(`auth failed (${res.status}): ${await res.text()}`);
  }
  captureCookie(res);
  console.log(setup.needsSetup ? `Created admin ${EMAIL}` : `Signed in as ${EMAIL}`);
}

const types = [
  {
    name: "article",
    label: "Article",
    fields: [
      { name: "title", kind: "text", required: true },
      { name: "excerpt", kind: "text" },
      { name: "body", kind: "richtext" },
      { name: "author", kind: "text", indexed: true },
      { name: "readingMinutes", kind: "number" },
      { name: "featured", kind: "boolean", indexed: true },
    ],
  },
  {
    name: "changelog",
    label: "Changelog entry",
    fields: [
      { name: "title", kind: "text", required: true },
      { name: "version", kind: "text", required: true, unique: true },
      { name: "notes", kind: "richtext" },
      { name: "releasedOn", kind: "date", indexed: true },
    ],
  },
];

const entries: { type: string; slug: string; status: "draft" | "published"; data: Record<string, unknown> }[] = [
  {
    type: "article",
    slug: "what-is-opencms",
    status: "published",
    data: {
      title: "What is OpenCMS",
      excerpt: "A headless CMS you assemble from connectors, not a monolith you configure around.",
      body: "Every layer that touches infrastructure sits behind one small interface: the runtime, the database, object storage, the cache, and where the admin is hosted. Swap a connector and nothing else changes.",
      author: "Mehdi",
      readingMinutes: 4,
      featured: true,
    },
  },
  {
    type: "article",
    slug: "content-types-are-data",
    status: "published",
    data: {
      title: "Content types are data, not code",
      excerpt: "Adding a field never needs a migration, because the database shape never changes.",
      body: "Entries live in one fixed-schema table with their fields in a JSON column, validated on the way in. Fields flagged as indexed get a JSON expression index, so filtered queries stay B-tree lookups rather than scans.",
      author: "Mehdi",
      readingMinutes: 6,
      featured: true,
    },
  },
  {
    type: "article",
    slug: "writing-a-connector",
    status: "published",
    data: {
      title: "Writing a connector",
      excerpt: "A connector is only done when it passes the shared conformance suite.",
      body: "Implement DataConnector from @opencms/core, then run runDataConnectorSuite against it. That suite is the contract, which is why you never have to trust a README.",
      author: "Mehdi",
      readingMinutes: 8,
      featured: false,
    },
  },
  {
    type: "article",
    slug: "an-unpublished-draft",
    status: "draft",
    data: {
      title: "An unpublished draft",
      excerpt: "Anonymous callers cannot see this one, by id or by slug.",
      body: "This entry exists so the demo can show that drafts are invisible rather than merely filtered out of lists.",
      author: "Mehdi",
      readingMinutes: 2,
      featured: false,
    },
  },
  {
    type: "changelog",
    slug: "v0-1-0",
    status: "published",
    data: {
      title: "First public preview",
      version: "0.1.0",
      notes: "Core engine, SQLite and Cloudflare D1 connectors, auth with sessions and API keys, and the React admin UI.",
      releasedOn: "2026-07-28",
    },
  },
];

async function ensureType(type: (typeof types)[number]): Promise<void> {
  const res = await call("/api/content-types", { method: "POST", body: JSON.stringify(type) });
  if (res.status === 409) {
    console.log(`  type ${type.name} already exists, left as is`);
    return;
  }
  if (!res.ok) throw new Error(`create type ${type.name} (${res.status}): ${await res.text()}`);
  console.log(`  type ${type.name} created`);
}

async function ensureEntry(entry: (typeof entries)[number]): Promise<void> {
  const existing = await call(`/api/content/${entry.type}/slug/${entry.slug}`);

  if (existing.ok) {
    const current = (await existing.json()) as { id: string };
    const res = await call(`/api/content/${entry.type}/${current.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: entry.status, data: entry.data }),
    });
    if (!res.ok) throw new Error(`update ${entry.slug} (${res.status}): ${await res.text()}`);
    console.log(`  ${entry.type}/${entry.slug} updated`);
    return;
  }

  const res = await call(`/api/content/${entry.type}`, {
    method: "POST",
    body: JSON.stringify({ slug: entry.slug, status: entry.status, data: entry.data }),
  });
  if (!res.ok) throw new Error(`create ${entry.slug} (${res.status}): ${await res.text()}`);
  console.log(`  ${entry.type}/${entry.slug} created`);
}

console.log(`Seeding ${BASE}`);
await authenticate();

console.log("Content types:");
for (const type of types) await ensureType(type);

console.log("Entries:");
for (const entry of entries) await ensureEntry(entry);

const published = await fetch(`${BASE}/api/content/article`).then(
  (r) => r.json() as Promise<{ total: number }>
);
console.log(`\nDone. ${published.total} published articles readable anonymously at`);
console.log(`  ${BASE}/api/content/article`);
