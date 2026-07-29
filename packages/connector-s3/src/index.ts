import { AwsClient } from "aws4fetch";
import type { StorageConnector, StorageListedObject, StorageObjectInfo } from "@opencms/core";

/**
 * `StorageConnector` over any S3-compatible object store: Cloudflare R2, MinIO,
 * AWS S3.
 *
 * Signing is aws4fetch rather than the AWS SDK, for one decisive reason: this
 * has to run unchanged on both Bun and Cloudflare Workers, and aws4fetch is a
 * few kB of SigV4 over `fetch` with no Node built-ins. The SDK would dominate
 * the Worker bundle.
 *
 * Addressing is path-style (`/bucket/key`), which is what R2 and MinIO speak.
 * Set `forcePathStyle: false` for virtual-host style on AWS.
 */

export interface S3StorageOptions {
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Full endpoint, e.g. `https://<account>.r2.cloudflarestorage.com`. For R2
   * pass `accountId` instead and this is derived.
   */
  endpoint?: string;
  /** Cloudflare account id. Shorthand for the R2 endpoint. */
  accountId?: string;
  /** R2 ignores it but still requires it in the signature; "auto" is correct there. */
  region?: string;
  sessionToken?: string;
  /**
   * Base URL objects are publicly served from, e.g. an R2 custom domain. When
   * unset `publicUrl` returns null and callers fall back to proxying bytes
   * through the API.
   */
  publicBaseUrl?: string;
  /** Default true. AWS virtual-host style needs false. */
  forcePathStyle?: boolean;
  /** Injected in tests to point at an in-process S3 fake. */
  fetch?: (input: Request | string | URL, init?: RequestInit) => Promise<Response>;
}

export class S3StorageConnector implements StorageConnector {
  private client: AwsClient;
  private base: string;
  private bucket: string;
  private publicBaseUrl?: string;
  private fetchImpl: (input: Request | string | URL, init?: RequestInit) => Promise<Response>;
  private pathStyle: boolean;

  constructor(opts: S3StorageOptions) {
    const endpoint =
      opts.endpoint ??
      (opts.accountId ? `https://${opts.accountId}.r2.cloudflarestorage.com` : undefined);
    if (!endpoint) {
      throw new Error("S3StorageConnector needs either `endpoint` or `accountId`");
    }

    this.bucket = opts.bucket;
    this.base = endpoint.replace(/\/$/, "");
    this.pathStyle = opts.forcePathStyle ?? true;
    this.publicBaseUrl = opts.publicBaseUrl?.replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input as never, init));
    this.client = new AwsClient({
      accessKeyId: opts.accessKeyId,
      secretAccessKey: opts.secretAccessKey,
      sessionToken: opts.sessionToken,
      service: "s3",
      region: opts.region ?? "auto",
    });
  }

  /**
   * Percent-encode each segment but keep the separators, so `a/b.txt` stays two
   * path segments while a key containing a literal `/` inside a segment, or a
   * space, or `+`, survives the round trip. Encoding the whole key would turn
   * every slash into `%2F`; encoding nothing would break on spaces.
   */
  private encodeKey(key: string): string {
    return key.split("/").map(encodeURIComponent).join("/");
  }

  private objectUrl(key: string): string {
    return this.pathStyle
      ? `${this.base}/${this.bucket}/${this.encodeKey(key)}`
      : `${this.base.replace("://", `://${this.bucket}.`)}/${this.encodeKey(key)}`;
  }

  private bucketUrl(): string {
    return this.pathStyle
      ? `${this.base}/${this.bucket}`
      : this.base.replace("://", `://${this.bucket}.`);
  }

  private async send(url: string, init: RequestInit & { unsignedPayload?: boolean }) {
    const { unsignedPayload, ...rest } = init;
    const headers = new Headers(rest.headers);
    // aws4fetch hashes the body to sign it, which it cannot do for a stream.
    // Declaring the payload unsigned is the documented way out; TLS still
    // covers the bytes in transit, we just lose payload integrity in the
    // signature itself. Only streams take this path.
    if (unsignedPayload) headers.set("x-amz-content-sha256", "UNSIGNED-PAYLOAD");

    const signed = await this.client.sign(url, { ...rest, headers });
    return this.fetchImpl(signed);
  }

  private async fail(res: Response, action: string, key?: string): Promise<never> {
    const body = await res.text().catch(() => "");
    const code = /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? String(res.status);
    throw new Error(`s3 ${action}${key ? ` ${key}` : ""} failed: ${res.status} ${code}`);
  }

  async put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    opts: { contentType: string; contentLength?: number }
  ): Promise<StorageObjectInfo> {
    // S3 answers 411 MissingContentLength to a streamed PUT with no length,
    // so a stream is only forwarded when the caller told us how long it is.
    // Otherwise it is drained into memory first, which is the price of not
    // knowing. Confirmed against MinIO; the in-process fake accepts either.
    let payload: Uint8Array | ReadableStream<Uint8Array> = body;
    let size = opts.contentLength;

    if (body instanceof Uint8Array) {
      size = body.byteLength;
    } else if (size === undefined) {
      payload = await drain(body);
      size = (payload as Uint8Array).byteLength;
    }

    const streaming = !(payload instanceof Uint8Array);
    const res = await this.send(this.objectUrl(key), {
      method: "PUT",
      body: payload as unknown as RequestInit["body"],
      headers: { "content-type": opts.contentType, "content-length": String(size) },
      // aws4fetch cannot hash a stream to sign it; declaring the payload
      // unsigned is the documented way out. TLS still covers the bytes, we
      // just lose payload integrity inside the signature. Buffered uploads
      // keep the full signed hash.
      unsignedPayload: streaming,
      // undici and workerd both require this to send a streamed request body.
      ...(streaming ? { duplex: "half" } : {}),
    } as RequestInit & { unsignedPayload?: boolean });

    if (!res.ok) await this.fail(res, "put", key);
    await res.body?.cancel();

    return {
      key,
      size,
      contentType: opts.contentType,
      lastModified: new Date().toISOString(),
    };
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const res = await this.send(this.objectUrl(key), { method: "GET" });
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) await this.fail(res, "get", key);
    // A 200 with no body is legal for a zero-byte object; hand back an empty
    // stream so callers can treat "exists" and "readable" as the same thing.
    return res.body ?? new ReadableStream({ start: (c) => c.close() });
  }

  async head(key: string): Promise<StorageObjectInfo | null> {
    const res = await this.send(this.objectUrl(key), { method: "HEAD" });
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) await this.fail(res, "head", key);
    await res.body?.cancel();

    const lastModified = res.headers.get("last-modified");
    return {
      key,
      size: Number(res.headers.get("content-length") ?? 0),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      lastModified: lastModified
        ? new Date(lastModified).toISOString()
        : new Date(0).toISOString(),
    };
  }

  async delete(key: string): Promise<void> {
    const res = await this.send(this.objectUrl(key), { method: "DELETE" });
    // S3 returns 204 whether or not the key existed. 404 is tolerated too, for
    // stores that are stricter, because the contract says delete is a no-op.
    if (!res.ok && res.status !== 404) await this.fail(res, "delete", key);
    await res.body?.cancel();
  }

  async list(
    prefix: string,
    opts: { limit?: number; cursor?: string } = {}
  ): Promise<{ objects: StorageListedObject[]; cursor?: string }> {
    const url = new URL(this.bucketUrl());
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    url.searchParams.set("max-keys", String(opts.limit ?? 1000));
    // Ask for encoded keys so a key containing an XML-significant character,
    // a newline or a stray ampersand cannot corrupt the response we parse.
    url.searchParams.set("encoding-type", "url");
    if (opts.cursor) url.searchParams.set("continuation-token", opts.cursor);

    const res = await this.send(url.toString(), { method: "GET" });
    if (!res.ok) await this.fail(res, "list");
    const xml = await res.text();

    const objects: StorageListedObject[] = [];
    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = match[1];
      if (block === undefined) continue;
      const key = tag(block, "Key");
      if (key === null) continue;
      objects.push({
        key: decodeURIComponent(key),
        size: Number(tag(block, "Size") ?? 0),
        lastModified: new Date(tag(block, "LastModified") ?? 0).toISOString(),
        // No contentType: ListObjectsV2 does not return one, and guessing a
        // default here would be a lie that callers cannot distinguish from a
        // real answer. `head` when you need it.
      });
    }

    const truncated = tag(xml, "IsTruncated") === "true";
    const next = tag(xml, "NextContinuationToken");
    return truncated && next ? { objects, cursor: next } : { objects };
  }

  async publicUrl(key: string): Promise<string | null> {
    if (!this.publicBaseUrl) return null;
    return `${this.publicBaseUrl}/${this.encodeKey(key)}`;
  }
}

/** First occurrence of a simple, non-nested element's text content. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1]! : null;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
