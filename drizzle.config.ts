import { loadEnvFile } from 'node:process'

import { defineConfig } from 'drizzle-kit'

try {
  loadEnvFile('.env')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw error
  }
}

const migrationUrl =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.SUPABASE_POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL_NON_POOLING

if (!migrationUrl) {
  throw new Error(
    'DATABASE_MIGRATION_URL (or SUPABASE_POSTGRES_URL_NON_POOLING) is required for migrations',
  )
}

export default defineConfig({
  schema: './src/shared/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: migrationUrl,
  },
})
