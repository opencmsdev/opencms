/**
 * Object storage contract (media library). First implementation will be
 * S3-compatible (R2, MinIO, AWS). Defined now so core can reference it;
 * implemented in a later milestone.
 */
export interface StorageObjectInfo {
  key: string;
  size: number;
  contentType: string;
  lastModified: string;
}

/**
 * What a listing can actually guarantee.
 *
 * `contentType` is optional here and required on `StorageObjectInfo` because
 * S3's ListObjectsV2 does not return it: an S3-backed connector would have to
 * issue one HEAD per key to fill it in. Rather than let every connector invent
 * a different lie, the type says it may be missing and the compiler makes
 * callers deal with that. Use `head` when you need it for certain.
 */
export type StorageListedObject = Omit<StorageObjectInfo, "contentType"> & {
  contentType?: string;
};

export interface StorageConnector {
  /**
   * `contentLength` matters more than it looks. S3 rejects a PUT with a
   * streamed body and no `Content-Length` (411 MissingContentLength), so a
   * connector given a stream of unknown length has to buffer the whole thing
   * in memory to measure it. Pass the length whenever it is known, e.g. from
   * an upload's own `Content-Length`, and the bytes stream straight through.
   */
  put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    opts: { contentType: string; contentLength?: number }
  ): Promise<StorageObjectInfo>;
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  head(key: string): Promise<StorageObjectInfo | null>;
  delete(key: string): Promise<void>;
  /**
   * `cursor` is **opaque**. Pass back exactly what the previous page returned
   * and never parse, slice or reconstruct it: the in-memory connector happens
   * to use the last key, but S3 returns its own continuation token and
   * rejects anything it did not issue.
   */
  list(prefix: string, opts?: { limit?: number; cursor?: string }): Promise<{
    objects: StorageListedObject[];
    cursor?: string;
  }>;
  /** Presigned or public URL for serving media, when the backend supports it. */
  publicUrl(key: string): Promise<string | null>;
}
