CREATE TYPE "public"."b3_position_product" AS ENUM('equities', 'fixed-income', 'treasury-bonds', 'derivatives', 'securities-lending');--> statement-breakpoint
CREATE TYPE "public"."b3_sync_run_kind" AS ENUM('POSITION_D1');--> statement-breakpoint
CREATE TYPE "public"."b3_sync_run_status" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."b3_sync_trigger" AS ENUM('MANUAL', 'CRON');--> statement-breakpoint
CREATE TABLE "b3_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_hash" varchar(64) NOT NULL,
	"environment" "b3_environment" NOT NULL,
	"kind" "b3_sync_run_kind" DEFAULT 'POSITION_D1' NOT NULL,
	"status" "b3_sync_run_status" DEFAULT 'PENDING' NOT NULL,
	"trigger" "b3_sync_trigger" NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"business_day" date NOT NULL,
	"reference_date" date NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" varchar(80),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"environment" "b3_environment" NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"reference_date" date NOT NULL,
	"product" "b3_position_product" NOT NULL,
	"natural_key_hash" varchar(128) NOT NULL,
	"instrument_code" varchar(120),
	"quantity" numeric(28, 10),
	"raw_payload" jsonb NOT NULL,
	"source_synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "b3_sync_runs" ADD CONSTRAINT "b3_sync_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_positions" ADD CONSTRAINT "portfolio_positions_sync_run_id_b3_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."b3_sync_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "b3_sync_runs_document_env_kind_day_uq" ON "b3_sync_runs" USING btree ("document_hash","environment","kind","business_day");--> statement-breakpoint
CREATE INDEX "b3_sync_runs_user_started_idx" ON "b3_sync_runs" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "b3_sync_runs_status_created_idx" ON "b3_sync_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_positions_user_env_key_uq" ON "portfolio_positions" USING btree ("user_id","environment","natural_key_hash");--> statement-breakpoint
CREATE INDEX "portfolio_positions_user_env_idx" ON "portfolio_positions" USING btree ("user_id","environment");--> statement-breakpoint
CREATE INDEX "portfolio_positions_sync_run_idx" ON "portfolio_positions" USING btree ("sync_run_id");