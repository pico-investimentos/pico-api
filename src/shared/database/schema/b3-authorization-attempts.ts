import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

import { b3ConnectionStatus } from './b3-connections.js'
import { users } from './users.js'

export const b3Environment = pgEnum('b3_environment', ['certification', 'production'])

export const b3AuthorizationAttempts = pgTable(
  'b3_authorization_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    idempotencyKeyHash: varchar('idempotency_key_hash', { length: 128 }).notNull(),
    environment: b3Environment('environment').notNull(),
    status: b3ConnectionStatus('status').notNull().default('AUTHORIZATION_REQUESTED'),
    requestId: varchar('request_id', { length: 100 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('b3_authorization_attempts_user_key_uq').on(
      table.userId,
      table.idempotencyKeyHash,
    ),
    index('b3_authorization_attempts_user_created_idx').on(table.userId, table.createdAt),
  ],
)
