ALTER TYPE "public"."b3_position_dispatch_status" ADD VALUE 'RUNNING' BEFORE 'SUCCEEDED';--> statement-breakpoint
ALTER TYPE "public"."b3_position_dispatch_status" ADD VALUE 'SUPERSEDED';--> statement-breakpoint
ALTER TABLE "b3_position_dispatches" ADD COLUMN "business_day" date;--> statement-breakpoint
UPDATE "b3_position_dispatches"
SET "business_day" = ("created_at" AT TIME ZONE 'America/Sao_Paulo')::date
WHERE "business_day" IS NULL;--> statement-breakpoint
ALTER TABLE "b3_position_dispatches" ALTER COLUMN "business_day" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "b3_position_dispatches" ADD COLUMN "lease_token" varchar(64);--> statement-breakpoint
ALTER TABLE "b3_position_dispatches" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
WITH "ranked_running" AS (
	SELECT
		"id",
		ROW_NUMBER() OVER (
			PARTITION BY "document_hash", "environment"
			ORDER BY "reference_date", "created_at"
		) AS "position"
	FROM "b3_sync_runs"
	WHERE "status" = 'RUNNING'
)
UPDATE "b3_sync_runs"
SET
	"status" = 'FAILED',
	"finished_at" = now(),
	"error_code" = 'MIGRATION_CONCURRENT_RUN',
	"error_message" = 'Closed while enforcing one running position sync per CPF',
	"updated_at" = now()
FROM "ranked_running"
WHERE
	"b3_sync_runs"."id" = "ranked_running"."id"
	AND "ranked_running"."position" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "b3_sync_runs_document_env_running_uq" ON "b3_sync_runs" USING btree ("document_hash","environment") WHERE "b3_sync_runs"."status" = 'RUNNING';