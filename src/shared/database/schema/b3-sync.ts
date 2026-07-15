import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

import { users } from './users.js'
import { b3Environment } from './b3-authorization-attempts.js'

export const b3SyncRunKind = pgEnum('b3_sync_run_kind', ['POSITION_D1'])

export const b3SyncRunStatus = pgEnum('b3_sync_run_status', [
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
])

export const b3SyncTrigger = pgEnum('b3_sync_trigger', ['MANUAL', 'CRON'])
export const b3PositionDispatchStatus = pgEnum(
  'b3_position_dispatch_status',
  ['PENDING', 'RUNNING', 'SUCCEEDED', 'SUPERSEDED'],
)

export const b3PositionProduct = pgEnum('b3_position_product', [
  'equities',
  'fixed-income',
  'treasury-bonds',
  'derivatives',
  'securities-lending',
])

export const b3SyncRuns = pgTable(
  'b3_sync_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    documentHash: varchar('document_hash', { length: 64 }).notNull(),
    environment: b3Environment('environment').notNull(),
    kind: b3SyncRunKind('kind').notNull().default('POSITION_D1'),
    status: b3SyncRunStatus('status').notNull().default('PENDING'),
    trigger: b3SyncTrigger('trigger').notNull(),
    requestId: varchar('request_id', { length: 100 }).notNull(),
    businessDay: date('business_day').notNull(),
    referenceDate: date('reference_date').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    errorCode: varchar('error_code', { length: 80 }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('b3_sync_runs_document_env_kind_day_uq').on(
      table.documentHash,
      table.environment,
      table.kind,
      table.businessDay,
    ),
    uniqueIndex('b3_sync_runs_document_env_running_uq')
      .on(table.documentHash, table.environment)
      .where(sql`${table.status} = 'RUNNING'`),
    index('b3_sync_runs_user_started_idx').on(table.userId, table.startedAt),
    index('b3_sync_runs_status_created_idx').on(table.status, table.createdAt),
  ],
)

export const b3PositionDispatches = pgTable(
  'b3_position_dispatches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    environment: b3Environment('environment').notNull(),
    referenceDate: date('reference_date').notNull(),
    businessDay: date('business_day').notNull(),
    status: b3PositionDispatchStatus('status').notNull().default('PENDING'),
    cursorUserId: uuid('cursor_user_id'),
    leaseToken: varchar('lease_token', { length: 64 }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    requestId: varchar('request_id', { length: 100 }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('b3_position_dispatches_env_reference_uq').on(
      table.environment,
      table.referenceDate,
    ),
    index('b3_position_dispatches_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
  ],
)

export const portfolioPositions = pgTable(
  'portfolio_positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    environment: b3Environment('environment').notNull(),
    syncRunId: uuid('sync_run_id')
      .notNull()
      .references(() => b3SyncRuns.id, { onDelete: 'restrict' }),
    referenceDate: date('reference_date').notNull(),
    product: b3PositionProduct('product').notNull(),
    naturalKeyHash: varchar('natural_key_hash', { length: 128 }).notNull(),
    instrumentCode: varchar('instrument_code', { length: 120 }),
    quantity: numeric('quantity', { precision: 28, scale: 10 }),
    rawPayload: jsonb('raw_payload').notNull().$type<Record<string, unknown>>(),
    isCurrent: boolean('is_current').notNull().default(true),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    sourceSyncedAt: timestamp('source_synced_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('portfolio_positions_run_key_uq').on(
      table.syncRunId,
      table.naturalKeyHash,
    ),
    index('portfolio_positions_user_env_current_idx').on(
      table.userId,
      table.environment,
      table.isCurrent,
    ),
    index('portfolio_positions_sync_run_idx').on(table.syncRunId),
  ],
)
