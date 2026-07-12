import { defineConfig } from 'drizzle-kit'

const migrationUrl =
  process.env.DATABASE_MIGRATION_URL ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL

if (!migrationUrl) {
  throw new Error('DATABASE_MIGRATION_URL não configurada')
}

export default defineConfig({
  schema: './src/shared/database/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: migrationUrl,
  },
})
