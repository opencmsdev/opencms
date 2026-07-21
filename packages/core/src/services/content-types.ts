import type { DataConnector } from "../interfaces/data.ts";
import type { ContentTypeDef, ContentTypeInput } from "../types.ts";
import { validateContentTypeInput } from "../fields.ts";
import { ConflictError, NotFoundError } from "../errors.ts";

/** Injectable clock so tests are deterministic. */
export type Clock = () => Date;

export class ContentTypeService {
  constructor(
    private readonly data: DataConnector,
    private readonly clock: Clock = () => new Date()
  ) {}

  async list(): Promise<ContentTypeDef[]> {
    return this.data.listTypes();
  }

  async get(name: string): Promise<ContentTypeDef> {
    const def = await this.data.getType(name);
    if (!def) throw new NotFoundError(`content type "${name}" not found`);
    return def;
  }

  async create(input: ContentTypeInput): Promise<ContentTypeDef> {
    const valid = validateContentTypeInput(input);
    const existing = await this.data.getType(valid.name);
    if (existing) throw new ConflictError(`content type "${valid.name}" already exists`);
    const now = this.clock().toISOString();
    const def: ContentTypeDef = { ...valid, createdAt: now, updatedAt: now };
    await this.data.saveType(def);
    await this.data.ensureIndexes(def);
    return def;
  }

  async update(name: string, input: ContentTypeInput): Promise<ContentTypeDef> {
    const current = await this.get(name);
    const valid = validateContentTypeInput(input);
    if (valid.name !== name) {
      throw new ConflictError("renaming a content type is not supported yet");
    }
    const def: ContentTypeDef = {
      ...valid,
      createdAt: current.createdAt,
      updatedAt: this.clock().toISOString(),
    };
    await this.data.saveType(def);
    await this.data.ensureIndexes(def);
    return def;
  }

  async delete(name: string): Promise<void> {
    await this.get(name);
    const count = await this.data.countEntries(name);
    if (count > 0) {
      throw new ConflictError(
        `content type "${name}" still has ${count} entries; delete them first`
      );
    }
    await this.data.deleteType(name);
  }
}
