/**
 * Signed ListObjectsV2 against an S3-compatible bucket. Same signing stack as
 * `@opencms/connector-s3` (aws4fetch, path-style). Used by s3/r2 `test()` so
 * setup fails if the keys cannot actually talk to the bucket.
 */
import { AwsClient } from "aws4fetch";

export type FetchLike = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

export function objectStoreEndpoint(env: Record<string, string>): string | undefined {
  if (env.OPENCMS_S3_ENDPOINT) return env.OPENCMS_S3_ENDPOINT.replace(/\/$/, "");
  if (env.OPENCMS_S3_ACCOUNT_ID) {
    return `https://${env.OPENCMS_S3_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  }
  const region = env.OPENCMS_S3_REGION;
  if (region && region !== "auto") return `https://s3.${region}.amazonaws.com`;
  return undefined;
}

export async function probeObjectStore(opts: {
  bucket: string;
  endpoint: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  fetch?: FetchLike;
}): Promise<void> {
  const base = opts.endpoint.replace(/\/$/, "");
  const url = new URL(`${base}/${opts.bucket}`);
  url.searchParams.set("list-type", "2");
  url.searchParams.set("max-keys", "1");

  const client = new AwsClient({
    accessKeyId: opts.accessKeyId,
    secretAccessKey: opts.secretAccessKey,
    service: "s3",
    region: opts.region && opts.region !== "" ? opts.region : "auto",
  });
  const signed = await client.sign(url.toString(), { method: "GET" });
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  let res: Response;
  try {
    res = await fetchImpl(signed);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`could not reach ${opts.bucket} at ${base}: ${reason}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? String(res.status);
    throw new Error(`list ${opts.bucket} failed: ${res.status} ${code}`);
  }
  await res.body?.cancel();
}
