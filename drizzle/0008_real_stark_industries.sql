CREATE TYPE "public"."source_url_kind" AS ENUM('monthly', 'fixed');--> statement-breakpoint
ALTER TABLE "spec_documents" ALTER COLUMN "document_month" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "spec_sources" ADD COLUMN "url_kind" "source_url_kind" DEFAULT 'monthly' NOT NULL;