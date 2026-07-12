import { jsonb, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  action: varchar('action', { length: 80 }).notNull(),
  actorType: varchar('actor_type', { length: 40 }).notNull(),
  actorId: uuid('actor_id'),
  targetType: varchar('target_type', { length: 40 }).notNull(),
  targetId: uuid('target_id'),
  requestId: varchar('request_id', { length: 100 }).notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
