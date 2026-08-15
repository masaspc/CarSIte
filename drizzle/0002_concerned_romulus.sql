ALTER TABLE "grades" DROP CONSTRAINT "grades_model_name_key";--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "type_designation" text;--> statement-breakpoint
ALTER TABLE "grades" ADD COLUMN "powertrain" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_model_powertrain_drive_name_key" UNIQUE("model_id","powertrain","drive_system","name");--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_type_designation_key" UNIQUE("type_designation");