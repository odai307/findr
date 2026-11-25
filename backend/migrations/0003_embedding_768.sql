-- Vectors move from 512 to 768 numbers (Gemini embeddings). Old vectors can't be converted, so
-- they are cleared first; the sync engine's backfill re-embeds those chunks on the next sync.
UPDATE "chunks" SET "embedding" = NULL, "embedding_model" = NULL;--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE halfvec(768);
