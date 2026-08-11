import type {
  StorageConnector,
  StorageListedObject,
  StorageObjectInfo,
} from "../interfaces/storage.ts";
import { NotFoundError, ValidationError } from "../errors.ts";
import { slugify } from "../slug.ts";
import type { Clock } from "./content-types.ts";
import type { IdGenerator } from "./entries.ts";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Media semantics on top of a `StorageConnector`. The connector moves bytes;
 * this service owns key generation, key hygiene and listing limits, so every
 * connector behaves the same way once it is behind the API.
 *
 * Keys are `YYYY/MM/<name>-<id>.<ext>`: date-prefixed so listings group
 * usefully, slugified so they are URL-safe without encoding, and suffixed
 * with a fresh id so re-uploading the same filename never overwrites.
 */
export class MediaService {
  constructor(
    private readonly storage: StorageConnector,
    private readonly clock: Clock = () => new Date(),
    private readonly newId: IdGenerator = () => crypto.randomUUID()
  ) {}

  /** Reject anything that could escape or alias the key space. */
  private assertSafeKey(key: string): void {
    const bad =
      key.length === 0 ||
      key.length > 512 ||
      key.startsWith("/") ||
      key.includes("\\") ||
      key.split("/").some((seg) => seg === "" || seg === "." || seg === "..") ||
      /[\s\u0000-\u001f\u007f]/.test(key);
    if (bad) throw new ValidationError(`invalid media key "${key}"`);
  }

  private keyFor(filename: string): string {
    const now = this.clock();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");

    const dot = filename.lastIndexOf(".");
    const rawBase = dot > 0 ? filename.slice(0, dot) : filename;
    const rawExt = dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
    const base = slugify(rawBase, "file");
    const ext = /^[a-z0-9]{1,10}$/.test(rawExt) ? `.${rawExt}` : "";

    return `${yyyy}/${mm}/${base}-${this.newId().slice(0, 8)}${ext}`;
  }

  async upload(
    filename: string,
    body: Uint8Array | ReadableStream<Uint8Array>,
    opts: { contentType?: string; contentLength?: number } = {}
  ): Promise<StorageObjectInfo> {
    if (typeof filename !== "string" || filename.trim().length === 0) {
      throw new ValidationError("a filename is required");
    }
    return this.storage.put(this.keyFor(filename), body, {
      contentType: opts.contentType || "application/octet-stream",
      contentLength: opts.contentLength,
    });
  }

  /**
   * Bytes plus metadata for serving. One `head` then one `get`; the object
   * vanishing between the two surfaces as the stream erroring, which is the
   * price of not buffering.
   */
  async serve(
    key: string
  ): Promise<{ info: StorageObjectInfo; body: ReadableStream<Uint8Array> }> {
    this.assertSafeKey(key);
    const info = await this.storage.head(key);
    if (!info) throw new NotFoundError(`media "${key}" not found`);
    const body = await this.storage.get(key);
    if (!body) throw new NotFoundError(`media "${key}" not found`);
    return { info, body };
  }

  /** Public URL when the backend has one (e.g. an R2 custom domain), else null. */
  async publicUrl(key: string): Promise<string | null> {
    this.assertSafeKey(key);
    return this.storage.publicUrl(key);
  }

  async list(
    opts: { prefix?: string; limit?: number; cursor?: string } = {}
  ): Promise<{ objects: StorageListedObject[]; cursor?: string }> {
    const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    return this.storage.list(opts.prefix ?? "", { limit, cursor: opts.cursor });
  }

  /** Idempotent, matching S3: deleting an absent key succeeds. */
  async delete(key: string): Promise<void> {
    this.assertSafeKey(key);
    await this.storage.delete(key);
  }
}
