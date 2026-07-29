/**
 * An in-process, S3-compatible object store.
 *
 * Enough of the S3 REST API for `runStorageConnectorSuite` to exercise a real
 * S3 connector, including its request building, XML parsing and error mapping,
 * without credentials or a network. CI stays green offline; the live suite
 * against a real bucket is what covers the rest.
 *
 * It implements exactly the subset the connector uses, and deliberately
 * mirrors S3's awkward parts rather than smoothing them, because those are
 * where connectors break:
 *
 * - keys arrive percent-encoded in the path and must be decoded
 * - a missing key is a 404 carrying an XML error body, not an empty 200
 * - ListObjectsV2 pages with an opaque continuation token, and sets
 *   `IsTruncated` rather than relying on a short page
 * - with `encoding-type=url`, keys come back percent-encoded in the XML
 *
 * Path-style addressing only (`/bucket/key`), which is what R2 and MinIO use.
 */

export interface S3Fake {
  /** Drop-in replacement for `fetch`, to be handed to the connector. */
  fetch: (input: Request | string | URL, init?: RequestInit) => Promise<Response>;
  /** Number of objects currently stored, for assertions. */
  size: () => number;
  reset: () => void;
}

interface StoredObject {
  body: Uint8Array;
  contentType: string;
  lastModified: Date;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function errorResponse(status: number, code: string, message: string): Response {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${xmlEscape(
      message
    )}</Message></Error>`,
    { status, headers: { "content-type": "application/xml" } }
  );
}

export function createS3Fake(opts: { bucket: string; now?: () => Date }): S3Fake {
  const objects = new Map<string, StoredObject>();
  const now = opts.now ?? (() => new Date());

  function objectHeaders(o: StoredObject): Headers {
    return new Headers({
      "content-type": o.contentType,
      "content-length": String(o.body.byteLength),
      "last-modified": o.lastModified.toUTCString(),
      etag: `"${o.body.byteLength.toString(16)}"`,
    });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // Path-style: /<bucket>[/<key...>]
    const segments = url.pathname.replace(/^\//, "").split("/");
    const bucket = segments.shift();
    if (bucket !== opts.bucket) {
      return errorResponse(404, "NoSuchBucket", `no such bucket: ${bucket}`);
    }
    // Decode per segment: the connector encodes each one and leaves the
    // separators, so joining first then decoding would lose an encoded slash.
    const key = segments.map((s) => decodeURIComponent(s)).join("/");

    if (key === "") {
      if (request.method !== "GET") {
        return errorResponse(405, "MethodNotAllowed", `${request.method} on the bucket`);
      }
      return list(url);
    }

    switch (request.method) {
      case "PUT": {
        // Real S3 answers 411 to a PUT with no Content-Length, which is how a
        // streamed upload of unknown length fails. Enforced here so that bug
        // is caught offline instead of only against a live bucket, which is
        // where it was originally found.
        if (request.headers.get("content-length") === null) {
          return errorResponse(411, "MissingContentLength", "a PUT must declare Content-Length");
        }
        const body = new Uint8Array(await request.arrayBuffer());
        objects.set(key, {
          body,
          contentType: request.headers.get("content-type") ?? "application/octet-stream",
          lastModified: now(),
        });
        return new Response(null, { status: 200, headers: { etag: `"${body.byteLength}"` } });
      }
      case "GET":
      case "HEAD": {
        const o = objects.get(key);
        if (!o) return errorResponse(404, "NoSuchKey", `no such key: ${key}`);
        return new Response(request.method === "HEAD" ? null : o.body, {
          status: 200,
          headers: objectHeaders(o),
        });
      }
      case "DELETE": {
        // S3 answers 204 whether or not the key was there.
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      default:
        return errorResponse(405, "MethodNotAllowed", request.method);
    }
  }

  function list(url: URL): Response {
    const q = url.searchParams;
    if (q.get("list-type") !== "2") {
      return errorResponse(400, "InvalidArgument", "only ListObjectsV2 is implemented");
    }
    const prefix = q.get("prefix") ?? "";
    const maxKeys = Number(q.get("max-keys") ?? "1000");
    const token = q.get("continuation-token");
    const encodeKeys = q.get("encoding-type") === "url";

    const after = token ? decodeURIComponent(token) : null;
    const matching = [...objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .filter((k) => (after === null ? true : k > after))
      .sort();

    const page = matching.slice(0, maxKeys);
    const truncated = matching.length > page.length;
    const enc = (s: string) => (encodeKeys ? encodeURIComponent(s) : xmlEscape(s));

    const contents = page
      .map((k) => {
        const o = objects.get(k)!;
        return `<Contents><Key>${enc(k)}</Key><LastModified>${o.lastModified.toISOString()}</LastModified><ETag>&quot;${
          o.body.byteLength
        }&quot;</ETag><Size>${o.body.byteLength}</Size><StorageClass>STANDARD</StorageClass></Contents>`;
      })
      .join("");

    const next =
      truncated && page.length
        ? `<NextContinuationToken>${enc(page[page.length - 1]!)}</NextContinuationToken>`
        : "";

    const body =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
      `<Name>${xmlEscape(opts.bucket)}</Name><Prefix>${enc(prefix)}</Prefix>` +
      `<KeyCount>${page.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys>` +
      (encodeKeys ? `<EncodingType>url</EncodingType>` : "") +
      `<IsTruncated>${truncated}</IsTruncated>${contents}${next}</ListBucketResult>`;

    return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
  }

  return {
    fetch: (input, init) => handle(new Request(input as never, init)),
    size: () => objects.size,
    reset: () => objects.clear(),
  };
}
