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

export interface StorageConnector {
  put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    opts: { contentType: string }
  ): Promise<StorageObjectInfo>;
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  head(key: string): Promise<StorageObjectInfo | null>;
  delete(key: string): Promise<void>;
  list(prefix: string, opts?: { limit?: number; cursor?: string }): Promise<{
    objects: StorageObjectInfo[];
    cursor?: string;
  }>;
  /** Presigned or public URL for serving media, when the backend supports it. */
  publicUrl(key: string): Promise<string | null>;
}
