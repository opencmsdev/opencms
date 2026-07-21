import type {
  ContentTypeDef,
  Entry,
  EntryQuery,
  QueryResult,
} from "../types.ts";

/**
 * The data connector contract. Implementations are thin: no validation, no
 * slug logic, no business rules. Core services own semantics; connectors own
 * persistence and query execution.
 *
 * A connector is considered valid when it passes the @opencms/test-kit
 * conformance suite.
 */
export interface DataConnector {
  /** Create the fixed schema if needed. Idempotent. */
  init(): Promise<void>;

  // Content types -----------------------------------------------------------
  listTypes(): Promise<ContentTypeDef[]>;
  getType(name: string): Promise<ContentTypeDef | null>;
  /** Insert or replace a full definition. */
  saveType(def: ContentTypeDef): Promise<void>;
  deleteType(name: string): Promise<void>;

  /**
   * Bring native indexes in line with the definition's `indexed` flags.
   * The only DDL a connector ever runs after init. Idempotent.
   */
  ensureIndexes(def: ContentTypeDef): Promise<void>;

  // Entries ------------------------------------------------------------------
  insertEntry(entry: Entry): Promise<void>;
  /** Replace a stored entry wholesale (core supplies the merged object). */
  updateEntry(entry: Entry): Promise<void>;
  getEntryById(type: string, id: string): Promise<Entry | null>;
  getEntryBySlug(type: string, slug: string): Promise<Entry | null>;
  deleteEntry(type: string, id: string): Promise<void>;
  /**
   * Execute a query. Filter fields are either system fields (id, slug,
   * status, createdAt, updatedAt, publishedAt) or data fields (inside the
   * JSON payload). Must return a stable order when sort is provided and
   * an exact total independent of limit/offset.
   */
  queryEntries(type: string, query: EntryQuery): Promise<QueryResult<Entry>>;
  countEntries(type: string): Promise<number>;

  close(): Promise<void>;
}
