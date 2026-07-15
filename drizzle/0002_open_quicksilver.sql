CREATE TABLE "rate_limit_buckets" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"attempt_count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
