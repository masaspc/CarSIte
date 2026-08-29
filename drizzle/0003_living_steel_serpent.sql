CREATE TYPE "public"."change_kind" AS ENUM('new_model', 'new_grade', 'price_change', 'spec_change', 'discontinued');--> statement-breakpoint
CREATE TYPE "public"."change_status" AS ENUM('pending', 'approved', 'rejected', 'applied', 'stale');--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_document_id" uuid NOT NULL,
	"kind" "change_kind" NOT NULL,
	"target_key" text NOT NULL,
	"diff" jsonb NOT NULL,
	"status" "change_status" DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "change_requests_document_kind_target_key" UNIQUE("spec_document_id","kind","target_key")
);
--> statement-breakpoint
CREATE TABLE "extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_document_id" uuid NOT NULL,
	"model_id_used" text NOT NULL,
	"raw_output" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"succeeded" boolean NOT NULL,
	"error" text,
	"extracted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spec_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_source_id" uuid NOT NULL,
	"pdf_url" text NOT NULL,
	"document_month" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_size" integer NOT NULL,
	"page_count" smallint NOT NULL,
	"stored_path" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spec_documents_source_sha_key" UNIQUE("spec_source_id","sha256"),
	CONSTRAINT "spec_documents_month_check" CHECK ("spec_documents"."document_month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "spec_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"pdf_base_url" text NOT NULL,
	"known_month" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone,
	"consecutive_failures" smallint DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "spec_sources_base_url_key" UNIQUE("pdf_base_url"),
	CONSTRAINT "spec_sources_known_month_check" CHECK ("spec_sources"."known_month" ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_spec_document_id_spec_documents_id_fk" FOREIGN KEY ("spec_document_id") REFERENCES "public"."spec_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_spec_document_id_spec_documents_id_fk" FOREIGN KEY ("spec_document_id") REFERENCES "public"."spec_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_documents" ADD CONSTRAINT "spec_documents_spec_source_id_spec_sources_id_fk" FOREIGN KEY ("spec_source_id") REFERENCES "public"."spec_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spec_sources" ADD CONSTRAINT "spec_sources_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_requests_status_idx" ON "change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "extractions_document_id_idx" ON "extractions" USING btree ("spec_document_id");--> statement-breakpoint
CREATE INDEX "spec_documents_source_id_idx" ON "spec_documents" USING btree ("spec_source_id");--> statement-breakpoint
CREATE INDEX "spec_sources_model_id_idx" ON "spec_sources" USING btree ("model_id");