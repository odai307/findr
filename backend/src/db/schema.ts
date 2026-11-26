import { sql } from 'drizzle-orm';
import {
  customType,
  halfvec,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

/**
 * Identity and tenancy (phase 0), then connections, documents and chunks (phase 1).
 * IDs are UUIDv7 (time-ordered, so new rows land at the end of the index instead of randomly).
 */
const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const workspaceRole = pgEnum('workspace_role', ['owner', 'admin', 'member']);

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Always stored lowercased by the application, so the unique index is case-insensitive. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    avatarUrl: text('avatar_url'),
    /** Google's stable account ID (the `sub` claim). Null for dev-login users. */
    googleSub: text('google_sub'),
    /** Set only when a provider (Google) has verified the address. See fix S2. */
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    uniqueIndex('users_google_sub_key').on(t.googleSub),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    plan: text('plan').notNull().default('free'),
    dailyAskLimit: integer('daily_ask_limit').notNull().default(200),
    ...timestamps,
  },
  (t) => [uniqueIndex('workspaces_slug_key').on(t.slug)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: workspaceRole('role').notNull(),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_idx').on(t.userId),
  ],
);

/**
 * Refresh tokens rotate on every use. All tokens from one login share a `familyId`;
 * if an already-used token is presented again, the whole family is revoked (likely theft).
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: uuid('replaced_by'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_key').on(t.tokenHash),
    index('refresh_tokens_family_idx').on(t.familyId),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_workspace_idx').on(t.workspaceId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceRole = (typeof workspaceRole.enumValues)[number];

// ---------------------------------------------------------------------------
// Phase 1: connections, sync runs, documents, access lists and chunks
// ---------------------------------------------------------------------------

/**
 * Embedding size. Fix C1 picked something smaller than the usual 1536 to save storage; 768 is the
 * smallest size Google recommends for its Gemini embedding models (~1.5 KB per chunk as halfvec).
 */
export const EMBEDDING_DIMENSIONS = 768;

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const connectionStatus = pgEnum('connection_status', [
  'active',
  'syncing',
  'paused',
  'error',
  'revoked',
]);
export const connectionVisibility = pgEnum('connection_visibility', ['personal', 'workspace']);

/**
 * Where a connection is in its sync. The full-sync cursor is saved after every committed batch,
 * so a crashed sync resumes instead of starting over.
 */
export interface SyncState {
  /** Resume point inside an unfinished full sync. */
  fullCursor?: unknown;
  /** Change token captured when the current full sync started; becomes `incremental` at the end. */
  pendingIncremental?: unknown;
  /** Where the next incremental sync starts. */
  incremental?: unknown;
}

export const connections = pgTable(
  'connections',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    visibility: connectionVisibility('visibility').notNull().default('personal'),
    externalAccountId: text('external_account_id').notNull(),
    displayName: text('display_name').notNull(),
    status: connectionStatus('status').notNull().default('active'),
    /** Encrypted OAuth tokens (envelope encryption). Arrives with real connectors in phase 4. */
    encryptedCredentials: text('encrypted_credentials'),
    syncState: jsonb('sync_state').$type<SyncState>().notNull().default({}),
    /** Database-level sync lock: a sync owns the connection until this time (renewed by heartbeat). */
    lockExpiresAt: timestamp('lock_expires_at', { withTimezone: true }),
    lastFullSyncAt: timestamp('last_full_sync_at', { withTimezone: true }),
    lastIncrementalSyncAt: timestamp('last_incremental_sync_at', { withTimezone: true }),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('connections_account_key').on(t.workspaceId, t.provider, t.externalAccountId),
  ],
);

export const syncRuns = pgTable(
  'sync_runs',
  {
    id: id(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['full', 'incremental'] }).notNull(),
    status: text('status', { enum: ['running', 'succeeded', 'failed'] }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsUpserted: integer('items_upserted').notNull().default(0),
    itemsUnchanged: integer('items_unchanged').notNull().default(0),
    itemsDeleted: integer('items_deleted').notNull().default(0),
    chunksEmbedded: integer('chunks_embedded').notNull().default(0),
    chunksReused: integer('chunks_reused').notNull().default(0),
    error: text('error'),
  },
  (t) => [index('sync_runs_connection_idx').on(t.connectionId, t.startedAt)],
);

export const documents = pgTable(
  'documents',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    type: text('type').notNull(),
    title: text('title'),
    url: text('url'),
    authorName: text('author_name'),
    authorEmail: text('author_email'),
    container: text('container'),
    mimeType: text('mime_type'),
    /** Hash of everything that gets embedded (header fields + text). Fix C2: excludes the ACL. */
    textHash: text('text_hash'),
    sourceCreatedAt: timestamp('source_created_at', { withTimezone: true }),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    indexedAt: timestamp('indexed_at', { withTimezone: true }),
    indexStatus: text('index_status', {
      enum: ['pending', 'indexed', 'awaiting_parser', 'failed'],
    })
      .notNull()
      .default('pending'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('documents_external_key').on(t.connectionId, t.externalId),
    index('documents_ws_updated_idx')
      .on(t.workspaceId, t.sourceUpdatedAt.desc())
      .where(sql`${t.deletedAt} is null`),
  ],
);

/** Source of truth for who may see a document. Fix S5: carries workspace_id for RLS. */
export const documentAcl = pgTable(
  'document_acl',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    principal: text('principal').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.principal] }),
    index('document_acl_principal_idx').on(t.workspaceId, t.principal),
  ],
);

export const chunks = pgTable(
  'chunks',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    chunkIndex: integer('chunk_index').notNull(),
    contextHeader: text('context_header').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    /** Hash of exactly what was embedded (header + content). Fix C3: lets edits reuse embeddings. */
    textHash: text('text_hash').notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(context_header, '')), 'A') || setweight(to_tsvector('english', content), 'B')`,
    ),
    embedding: halfvec('embedding', { dimensions: EMBEDDING_DIMENSIONS }),
    embeddingModel: text('embedding_model'),
    // Fix Q2: copies of document fields, so search can filter before its LIMIT.
    acl: text('acl').array().notNull(),
    provider: text('provider').notNull(),
    docType: text('doc_type').notNull(),
    sourceUpdatedAt: timestamp('source_updated_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('chunks_document_key').on(t.documentId, t.chunkIndex),
    index('chunks_tsv_idx').using('gin', t.tsv),
    index('chunks_acl_idx').using('gin', t.acl),
    index('chunks_ws_live_idx')
      .on(t.workspaceId)
      .where(sql`${t.deletedAt} is null`),
    index('chunks_reuse_idx').on(t.workspaceId, t.textHash),
    // Fix Q3: no HNSW index in v1. Exact vector search within one workspace is fast at this size.
  ],
);

export type Connection = typeof connections.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;

// ---------------------------------------------------------------------------
// Core: AI answers (conversations, messages, feedback, usage)
// ---------------------------------------------------------------------------

/** One numbered source the answer may cite, as sent to the client. */
export interface Citation {
  n: number;
  documentId: string;
  title: string | null;
  url: string | null;
  provider: string;
  type: string;
  author: string | null;
  updatedAt: string | null;
  snippet: string;
}

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    ...timestamps,
  },
  (t) => [index('conversations_user_idx').on(t.workspaceId, t.userId, t.updatedAt)],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant'] }).notNull(),
    content: text('content').notNull(),
    status: text('status', { enum: ['complete', 'error', 'aborted'] })
      .notNull()
      .default('complete'),
    /** The standalone question actually searched for (follow-ups are rewritten). */
    rewrittenQuery: text('rewritten_query'),
    /** Only the sources the answer actually cited. */
    citations: jsonb('citations').$type<Citation[]>().notNull().default([]),
    retrievedChunkIds: uuid('retrieved_chunk_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    model: text('model'),
    promptTokens: integer('prompt_tokens'),
    completionTokens: integer('completion_tokens'),
    latencyMs: integer('latency_ms'),
    ttftMs: integer('ttft_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.createdAt)],
);

export const feedback = pgTable(
  'feedback',
  {
    id: id(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: integer('rating').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('feedback_message_user_key').on(t.messageId, t.userId)],
);

export const usageEvents = pgTable(
  'usage_events',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['ask', 'rewrite', 'search'] }).notNull(),
    model: text('model').notNull(),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('usage_events_ws_idx').on(t.workspaceId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Teams and the public API: invites and API keys
// ---------------------------------------------------------------------------

/**
 * A pending invitation to a workspace. The link holds a random token; only its hash is stored.
 * Single use, expires after 7 days, and only works for the invited email address.
 */
export const invites = pgTable(
  'invites',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: workspaceRole('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('invites_token_key').on(t.tokenHash),
    index('invites_workspace_idx').on(t.workspaceId),
  ],
);

/**
 * Keys for the public API (search and ask). Shown once at creation; only a hash is stored.
 * `prefix` is a short, non-secret part shown in the UI so people can tell keys apart.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: text('scopes').array().notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('api_keys_hash_key').on(t.keyHash),
    index('api_keys_workspace_idx').on(t.workspaceId),
  ],
);

export type ApiScope = 'search' | 'ask';
