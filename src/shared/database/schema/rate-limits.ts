import {
  integer,
  pgTable,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'

export const rateLimitBuckets = pgTable('rate_limit_buckets', {
  keyHash: varchar('key_hash', { length: 64 }).primaryKey(),
  attemptCount: integer('attempt_count').notNull(),
  windowStartedAt: timestamp('window_started_at', {
    withTimezone: true,
  }).notNull(),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
