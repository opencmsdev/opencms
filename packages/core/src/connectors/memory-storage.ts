import type {
  StorageConnector,
  StorageListedObject,
  StorageObjectInfo,
} from "../interfaces/storage.ts";

/**
 * In-memory reference implementation of `StorageConnector`.
 *
 * This is the storage-side twin of `MemoryDataConnector`: it exists to define
 * what the contract means, not to be deployed. Where the interface leaves a
 * behaviour open, whatever this does is the answer, and `runStorageConnectorSuite`
 * holds every other connector to it.
 *
 * Listing deliberately copies S3 semantics rather than inventing friendlier
 * ones, because S3 is what the real connectors sit on:
 *
 * - keys come back sorted ascending by UTF-16 code unit, which is what
 *   JavaScript's `<` gives and is close enough to S3's UTF-8 byte order for
 *   every key this CMS generates
 * - the cursor is the last key of the page, and paging resumes strictly after
 *   it, so a key inserted mid-scan behind the cursor is simply missed
 * - a page is only ever short when the listing is exhausted
 */
export class MemoryStorageConnector implements StorageConnector {
  private objects = new Map<
    string,
    { body: Uint8Array; contentType: string; lastModified: string }
  >();

  /** Injected so tests can pin timestamps, mirroring the `Clock` in core's services. */
  constructor(private now: () => Date = () => new Date()) {}

  async put(
    key: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    opts: { contentType: string }
  ): Promise<StorageObjectInfo> {
    const bytes = body instanceof Uint8Array ? body : await drain(body);
    const record = {
      body: bytes,
      contentType: opts.contentType,
      lastModified: this.now().toISOString(),
    };
    this.objects.set(key, record);
    return { key, size: bytes.byteLength, ...pick(record) };
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const record = this.objects.get(key);
    if (!record) return null;
    return new ReadableStream<Uint8Array>({
      start(controller) {
        // Copy: handing out the stored buffer would let a reader mutate it.
        controller.enqueue(new Uint8Array(record.body));
        controller.close();
      },
    });
  }

  async head(key: string): Promise<StorageObjectInfo | null> {
    const record = this.objects.get(key);
    if (!record) return null;
    return { key, size: record.body.byteLength, ...pick(record) };
  }

  /** Deleting a key that was never there is a no-op, as it is on S3. */
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(
    prefix: string,
    opts: { limit?: number; cursor?: string } = {}
  ): Promise<{ objects: StorageListedObject[]; cursor?: string }> {
    const limit = opts.limit ?? 1000;
    const keys = [...this.objects.keys()]
      .filter((k) => k.startsWith(prefix))
      .filter((k) => (opts.cursor === undefined ? true : k > opts.cursor))
      .sort();

    const page = keys.slice(0, limit);
    const objects = page.map((key) => {
      const record = this.objects.get(key)!;
      return { key, size: record.body.byteLength, ...pick(record) };
    });

    // A cursor is only returned when there is definitely more to read, so a
    // caller looping until `cursor` is undefined always terminates.
    const cursor = keys.length > page.length ? page[page.length - 1] : undefined;
    return cursor === undefined ? { objects } : { objects, cursor };
  }

  /** No HTTP surface, so nothing can be served directly from here. */
  async publicUrl(): Promise<string | null> {
    return null;
  }
}

function pick(record: { contentType: string; lastModified: string }) {
  return { contentType: record.contentType, lastModified: record.lastModified };
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
