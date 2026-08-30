ALTER TABLE "change_requests" DROP CONSTRAINT "change_requests_document_kind_target_key";--> statement-breakpoint
ALTER TABLE "change_requests" ADD COLUMN "diff_hash" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_document_kind_target_diff_key" UNIQUE("spec_document_id","kind","target_key","diff_hash");