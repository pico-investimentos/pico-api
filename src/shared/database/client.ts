import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as schema from './schema/index.js'

export type Database = PostgresJsDatabase<typeof schema>

export type DbExecutor =
  | Database
  | PgTransaction<
      PgQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >

export function createDatabaseClient(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  })

  const db = drizzle(sql, { schema })

  return {
    db,
    sql,
    async close() {
      await sql.end({ timeout: 5 })
    },
  }
}
