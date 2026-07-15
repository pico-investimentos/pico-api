CREATE TYPE "public"."b3_position_dispatch_status" AS ENUM('PENDING', 'SUCCEEDED');--> statement-breakpoint
CREATE TABLE "b3_position_dispatches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"environment" "b3_environment" NOT NULL,
	"reference_date" date NOT NULL,
	"status" "b3_position_dispatch_status" DEFAULT 'PENDING' NOT NULL,
	"cursor_user_id" uuid,
	"request_id" varchar(100) NOT NULL,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "portfolio_positions_user_env_key_uq";--> statement-breakpoint
DROP INDEX "portfolio_positions_user_env_idx";--> statement-breakpoint
ALTER TABLE "portfolio_positions" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "portfolio_positions" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "b3_position_dispatches_env_reference_uq" ON "b3_position_dispatches" USING btree ("environment","reference_date");--> statement-breakpoint
CREATE INDEX "b3_position_dispatches_status_created_idx" ON "b3_position_dispatches" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_positions_run_key_uq" ON "portfolio_positions" USING btree ("sync_run_id","natural_key_hash");--> statement-breakpoint
CREATE INDEX "portfolio_positions_user_env_current_idx" ON "portfolio_positions" USING btree ("user_id","environment","is_current");--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "users"
		WHERE "cpf" IS NOT NULL
		GROUP BY "cpf"
		HAVING COUNT(*) > 1
	) THEN
		RAISE EXCEPTION 'Cannot enforce users.cpf uniqueness: duplicate CPF rows must be resolved first';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_cpf_unique" UNIQUE("cpf");