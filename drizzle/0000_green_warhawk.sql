CREATE TYPE "public"."body_type" AS ENUM('軽自動車', 'コンパクトカー', 'セダン', 'ハッチバック', 'ステーションワゴン', 'SUV', 'ミニバン', 'スポーツカー', 'クーペ');--> statement-breakpoint
CREATE TYPE "public"."drive_system" AS ENUM('FF', 'FR', '4WD', 'MR', 'RR');--> statement-breakpoint
CREATE TYPE "public"."engine_type" AS ENUM('ガソリン', 'ハイブリッド', 'EV', 'ディーゼル', 'PHEV');--> statement-breakpoint
CREATE TYPE "public"."feature_availability" AS ENUM('standard', 'option', 'none', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."publication_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."transmission_type" AS ENUM('CVT', 'AT', 'MT', 'DCT', '電気式無段変速機', 'other');--> statement-breakpoint
CREATE TABLE "dealers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"manufacturer" text NOT NULL,
	"prefecture" text NOT NULL,
	"city" text,
	"address" text,
	"phone" text,
	"business_hours" text,
	"closed_days" text,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"publication_status" "publication_status" DEFAULT 'draft' NOT NULL,
	"price" integer NOT NULL,
	"release_date" text,
	"discontinued_at" text,
	"engine_type" "engine_type" NOT NULL,
	"drive_system" "drive_system" NOT NULL,
	"transmission" text,
	"transmission_type" "transmission_type",
	"gear_count" smallint,
	"seating" smallint NOT NULL,
	"displacement" integer,
	"weight" integer,
	"wltc_mode" numeric(4, 1),
	"cruising_range" integer,
	"eco_car_tax" boolean DEFAULT false NOT NULL,
	"airbags" smallint,
	"dimensions" jsonb,
	"performance" jsonb,
	"fuel_detail" jsonb,
	"images" jsonb,
	"extra_features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"collision_mitigation_brake" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"false_start_suppression" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"lane_departure_warning" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"lane_keeping_assist" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"adaptive_cruise_control" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"blind_spot_monitor" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"camera_360" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"parking_assist" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"navigation" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"etc" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"back_camera" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"power_seat" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"seat_heater" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"steering_heater" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"auto_aircon" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"led_headlight" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"smart_key" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"power_back_door" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"hands_free_back_door" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"sunroof" "feature_availability" DEFAULT 'unknown' NOT NULL,
	"source_url" text,
	"fetched_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"verified_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "grades_model_name_key" UNIQUE("model_id","name"),
	CONSTRAINT "grades_model_slug_key" UNIQUE("model_id","slug"),
	CONSTRAINT "grades_release_date_format" CHECK (release_date ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "grades_discontinued_at_format" CHECK (discontinued_at ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manufacturer" text NOT NULL,
	"manufacturer_slug" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"body_type" "body_type" NOT NULL,
	"official_url" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_manufacturer_name_key" UNIQUE("manufacturer","name"),
	CONSTRAINT "models_slug_key" UNIQUE("manufacturer_slug","slug")
);
--> statement-breakpoint
CREATE TABLE "price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grade_id" uuid NOT NULL,
	"date" text NOT NULL,
	"price" integer NOT NULL,
	"source_url" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_history_grade_date_key" UNIQUE("grade_id","date"),
	CONSTRAINT "price_history_date_format" CHECK (date ~ '^[0-9]{4}-[0-9]{2}$')
);
--> statement-breakpoint
ALTER TABLE "grades" ADD CONSTRAINT "grades_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "public"."grades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dealers_prefecture_idx" ON "dealers" USING btree ("prefecture");--> statement-breakpoint
CREATE INDEX "dealers_manufacturer_idx" ON "dealers" USING btree ("manufacturer");--> statement-breakpoint
CREATE INDEX "grades_model_id_idx" ON "grades" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "grades_status_price_idx" ON "grades" USING btree ("publication_status","price");--> statement-breakpoint
CREATE INDEX "grades_status_wltc_idx" ON "grades" USING btree ("publication_status","wltc_mode");--> statement-breakpoint
CREATE INDEX "grades_engine_type_idx" ON "grades" USING btree ("engine_type");--> statement-breakpoint
CREATE INDEX "grades_seating_idx" ON "grades" USING btree ("seating");--> statement-breakpoint
CREATE INDEX "models_body_type_idx" ON "models" USING btree ("body_type");--> statement-breakpoint
CREATE INDEX "price_history_grade_idx" ON "price_history" USING btree ("grade_id");