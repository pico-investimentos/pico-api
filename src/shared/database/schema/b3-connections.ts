import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { users } from './users.js'

export const b3ConnectionStatus = pgEnum('b3_connection_status', [
  'NOT_CONNECTED',
  'AUTHORIZATION_REQUESTED',
  'AUTHORIZED',
  'REVOKED',
  'ERROR',
])

export const b3Connections = pgTable(
  'b3_connections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: b3ConnectionStatus('status').notNull().default('NOT_CONNECTED'),
    latestAttemptId: uuid('latest_attempt_id'),
    authorizationRequestedAt: timestamp('authorization_requested_at', {
      withTimezone: true,
    }),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('b3_connections_user_id_uq').on(table.userId),
    index('b3_connections_status_idx').on(table.status),
  ],
)
