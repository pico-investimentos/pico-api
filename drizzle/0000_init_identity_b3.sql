CREATE TYPE "public"."b3_connection_status" AS ENUM('NOT_CONNECTED', 'AUTHORIZATION_REQUESTED', 'AUTHORIZED', 'REVOKED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."b3_environment" AS ENUM('certification', 'production');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" varchar(80) NOT NULL,
	"actor_type" varchar(40) NOT NULL,
	"actor_id" uuid,
	"target_type" varchar(40) NOT NULL,
	"target_id" uuid,
	"request_id" varchar(100) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "b3_authorization_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"idempotency_key_hash" varchar(128) NOT NULL,
	"environment" "b3_environment" NOT NULL,
	"status" "b3_connection_status" DEFAULT 'AUTHORIZATION_REQUESTED' NOT NULL,
	"request_id" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "b3_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "b3_connection_status" DEFAULT 'NOT_CONNECTED' NOT NULL,
	"latest_attempt_id" uuid,
	"authorization_requested_at" timestamp with time zone,
	"authorized_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(128) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"cpf" varchar(11),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "b3_authorization_attempts" ADD CONSTRAINT "b3_authorization_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "b3_connections" ADD CONSTRAINT "b3_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "b3_authorization_attempts_user_key_uq" ON "b3_authorization_attempts" USING btree ("user_id","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "b3_authorization_attempts_user_created_idx" ON "b3_authorization_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "b3_connections_user_id_uq" ON "b3_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "b3_connections_status_idx" ON "b3_connections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");