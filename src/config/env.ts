import { z } from 'zod'

const rawConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_ORIGINS: z
    .string()
    .trim()
    .min(1)
    .default('http://localhost:5173,http://localhost:5174'),
  LOG_LEVEL: z.enum(['info', 'silent']).default('info'),
  DATABASE_URL: z.string().optional(),
  DATABASE_MIGRATION_URL: z.string().optional(),
  POSTGRES_URL: z.string().optional(),
  POSTGRES_URL_NON_POOLING: z.string().optional(),
  SESSION_COOKIE_NAME: z.string().trim().min(1).default('pico_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  B3_ENVIRONMENT: z.enum(['certification', 'production']).optional(),
  B3_OPT_IN_URL: z.string().optional(),
  B3_OPT_IN_ALLOWED_HOSTS: z.string().optional(),
})

const originSchema = z.string().url().transform((value) => new URL(value).origin)

const TEST_B3_OPT_IN_URL = 'https://b3-optin.test.local/authorize'
const TEST_B3_ALLOWED_HOST = 'b3-optin.test.local'
const TEST_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/pico_test'

export type B3Config = Readonly<{
  environment: 'certification' | 'production'
  optInUrl: string
  allowedHosts: readonly string[]
}>

export type AppConfig = Readonly<{
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  appOrigins: readonly string[]
  logLevel: 'info' | 'silent'
  databaseUrl: string
  databaseMigrationUrl: string
  sessionCookieName: string
  sessionTtlHours: number
  b3: B3Config
}>

function resolveDatabaseUrl(
  raw: z.infer<typeof rawConfigSchema>,
  field: 'runtime' | 'migration',
): string | undefined {
  if (field === 'runtime') {
    return raw.DATABASE_URL ?? raw.POSTGRES_URL
  }

  return raw.DATABASE_MIGRATION_URL ?? raw.POSTGRES_URL_NON_POOLING ?? raw.DATABASE_URL ?? raw.POSTGRES_URL
}

function parseB3Config(raw: z.infer<typeof rawConfigSchema>): B3Config {
  const isTest = raw.NODE_ENV === 'test'
  const environment = raw.B3_ENVIRONMENT ?? (isTest ? 'certification' : undefined)
  const optInUrlRaw = raw.B3_OPT_IN_URL ?? (isTest ? TEST_B3_OPT_IN_URL : undefined)
  const allowedHostsRaw =
    raw.B3_OPT_IN_ALLOWED_HOSTS ?? (isTest ? TEST_B3_ALLOWED_HOST : undefined)

  if (!environment || !optInUrlRaw || !allowedHostsRaw) {
    throw new Error(
      'B3_ENVIRONMENT, B3_OPT_IN_URL and B3_OPT_IN_ALLOWED_HOSTS are required',
    )
  }

  const optInUrl = new URL(optInUrlRaw)
  const allowedHosts = [
    ...new Set(
      allowedHostsRaw
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean),
    ),
  ]

  if (optInUrl.protocol !== 'https:') {
    throw new Error('B3_OPT_IN_URL must use HTTPS')
  }

  if (!allowedHosts.includes(optInUrl.hostname)) {
    throw new Error('B3_OPT_IN_URL hostname is not allowed')
  }

  return Object.freeze({
    environment,
    optInUrl: optInUrl.toString(),
    allowedHosts: Object.freeze(allowedHosts),
  })
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): AppConfig {
  const rawConfig = rawConfigSchema.parse(environment)
  const originCandidates = rawConfig.APP_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const origins = z.array(originSchema).min(1).parse(originCandidates)

  const isTest = rawConfig.NODE_ENV === 'test'
  const databaseUrl =
    resolveDatabaseUrl(rawConfig, 'runtime') ?? (isTest ? TEST_DATABASE_URL : undefined)
  const databaseMigrationUrl =
    resolveDatabaseUrl(rawConfig, 'migration') ?? (isTest ? TEST_DATABASE_URL : undefined)

  if (!databaseUrl) {
    throw new Error('DATABASE_URL (or POSTGRES_URL) is required')
  }

  if (!databaseMigrationUrl) {
    throw new Error('DATABASE_MIGRATION_URL (or POSTGRES_URL_NON_POOLING) is required')
  }

  return Object.freeze({
    nodeEnv: rawConfig.NODE_ENV,
    port: rawConfig.PORT,
    appOrigins: Object.freeze([...new Set(origins)]),
    logLevel: rawConfig.LOG_LEVEL,
    databaseUrl,
    databaseMigrationUrl,
    sessionCookieName: rawConfig.SESSION_COOKIE_NAME,
    sessionTtlHours: rawConfig.SESSION_TTL_HOURS,
    b3: parseB3Config(rawConfig),
  })
}
