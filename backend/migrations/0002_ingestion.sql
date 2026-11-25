CREATE TYPE "public"."connection_status" AS ENUM('active', 'syncing', 'paused', 'error', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."connection_visibility" AS ENUM('personal', 'workspace');--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"context_header" text NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"text_hash" text NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(context_header, '')), 'A') || setweight(to_tsvector('english', content), 'B')) STORED,
	"embedding" halfvec(512),
	"embedding_model" text,
	"acl" text[] NOT NULL,
	"provider" text NOT NULL,
	"doc_type" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"visibility" "connection_visibility" DEFAULT 'personal' NOT NULL,
	"external_account_id" text NOT NULL,
	"display_name" text NOT NULL,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"encrypted_credentials" text,
	"sync_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"lock_expires_at" timestamp with time zone,
	"last_full_sync_at" timestamp with time zone,
	"last_incremental_sync_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_acl" (
	"document_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"principal" text NOT NULL,
	CONSTRAINT "document_acl_document_id_principal_pk" PRIMARY KEY("document_id","principal")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"url" text,
	"author_name" text,
	"author_email" text,
	"container" text,
	"mime_type" text,
	"text_hash" text,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"indexed_at" timestamp with time zone,
	"index_status" text DEFAULT 'pending' NOT NULL,
	"deleted_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_upserted" integer DEFAULT 0 NOT NULL,
	"items_unchanged" integer DEFAULT 0 NOT NULL,
	"items_deleted" integer DEFAULT 0 NOT NULL,
	"chunks_embedded" integer DEFAULT 0 NOT NULL,
	"chunks_reused" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acl" ADD CONSTRAINT "document_acl_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_acl" ADD CONSTRAINT "document_acl_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chunks_document_key" ON "chunks" USING btree ("document_id","chunk_index");--> statement-breakpoint
CREATE INDEX "chunks_tsv_idx" ON "chunks" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "chunks_acl_idx" ON "chunks" USING gin ("acl");--> statement-breakpoint
CREATE INDEX "chunks_ws_live_idx" ON "chunks" USING btree ("workspace_id") WHERE "chunks"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "chunks_reuse_idx" ON "chunks" USING btree ("workspace_id","text_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_account_key" ON "connections" USING btree ("workspace_id","provider","external_account_id");--> statement-breakpoint
CREATE INDEX "document_acl_principal_idx" ON "document_acl" USING btree ("workspace_id","principal");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_external_key" ON "documents" USING btree ("connection_id","external_id");--> statement-breakpoint
CREATE INDEX "documents_ws_updated_idx" ON "documents" USING btree ("workspace_id","source_updated_at" DESC NULLS LAST) WHERE "documents"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "sync_runs_connection_idx" ON "sync_runs" USING btree ("connection_id","started_at");