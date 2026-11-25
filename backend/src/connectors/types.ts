/**
 * The connector contract. A connector only knows how to talk to one app (Gmail, Drive, Slack,
 * the demo dataset…). Everything else — locking, cursor saving, chunking, embedding, retries —
 * is done by the sync engine, so a new connector stays small.
 */

export type DocumentType = 'email' | 'file' | 'message_thread' | 'page' | 'issue' | 'pull_request';

/** Opaque, JSON-serializable position in a provider's listing or change feed. */
export type Cursor = unknown;

export interface SourceDocument {
  /** The provider's own ID. Stable across syncs. */
  externalId: string;
  type: DocumentType;
  title: string | null;
  url: string;
  author?: { name?: string; email?: string };
  /** Thread, channel, folder or repo name. */
  container?: string;
  createdAt: Date;
  updatedAt: Date;
  /**
   * Who may see it, as principals:
   *   user:<platform user id> · email:<address> · group:<provider>:<id> · domain:<domain> ·
   *   workspace:<workspace id>
   */
  acl: string[];
  content:
    | { kind: 'text'; text: string; format: 'plain' | 'markdown' | 'html' }
    // Binary files are downloaded and parsed by the Python parser (phase 4).
    | { kind: 'file'; mimeType: string; sizeBytes: number };
  metadata?: Record<string, unknown>;
}

export interface SyncBatch {
  upserts: SourceDocument[];
  /** External IDs removed at the source. */
  deletions: string[];
  /** Saved only after this batch is committed, so a crash re-processes it rather than losing it. */
  cursor: Cursor;
}

export interface SyncContext {
  connectionId: string;
  workspaceId: string;
  /** The platform user who connected the account. Their personal items get `user:<id>`. */
  ownerUserId: string;
  signal: AbortSignal;
}

export interface Connector {
  provider: string;

  /**
   * Captures the provider's "changes since now" token (Gmail historyId, Drive startPageToken)
   * BEFORE a full sync lists anything, so changes made during the full sync aren't missed.
   */
  getIncrementalCursor(ctx: SyncContext): Promise<Cursor>;

  /** Lists everything, in batches. Resumes from `resumeCursor` after a crash. */
  fullSync(ctx: SyncContext, resumeCursor?: Cursor): AsyncGenerator<SyncBatch>;

  /** Changes since `cursor`. The last batch's cursor becomes the next starting point. */
  incrementalSync(ctx: SyncContext, cursor: Cursor): AsyncGenerator<SyncBatch>;
}
