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
  SUPABASE_POSTGRES_URL: z.string().optional(),
  SUPABASE_POSTGRES_URL_NON_POOLING: z.string().optional(),
  POSTGRES_URL: z.string().optional(),
  POSTGRES_URL_NON_POOLING: z.string().optional(),
  SESSION_COOKIE_NAME: z.string().trim().min(1).default('pico_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  RATE_LIMIT_KEY_SECRET: z.string().trim().min(32).optional(),
  B3_ENVIRONMENT: z.enum(['certification', 'production']).optional(),
  B3_OPT_IN_URL: z.string().optional(),
  B3_OPT_IN_ALLOWED_HOSTS: z.string().optional(),
  B3_API_BASE_URL: z.string().optional(),
  B3_SECRETS_DIR: z.string().optional(),
  B3_OAUTH_TOKEN_URL: z.string().optional(),
  B3_OAUTH_SCOPE: z.string().optional(),
  B3_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).optional(),
  B3_ALLOW_INMEMORY: z.enum(['0', '1']).optional(),
  CRON_SECRET: z.string().optional(),
})

const originSchema = z.string().url().transform((value) => new URL(value).origin)

const TEST_B3_OPT_IN_URL = 'https://b3-optin.test.local/authorize'
const TEST_B3_ALLOWED_HOST = 'b3-optin.test.local'
const TEST_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/pico_test'

const B3_API_BASE_BY_ENVIRONMENT = {
  certification: 'https://apib3i-cert.b3.com.br:2443',
  production: 'https://investidor.b3.com.br:2443',
} as const

const B3_OAUTH_BY_ENVIRONMENT = {
  certification: {
    // Pacote STVM / Área do Investidor em certificação
    tokenUrl:
      'https://login.microsoftonline.com/4bee639f-5388-44c7-bbac-cb92a93911e6/oauth2/v2.0/token',
    scope: '98ddf4b0-f66d-4c96-97ea-9e30306599e7/.default',
  },
  production: {
    tokenUrl:
      'https://login.microsoftonline.com/aa5ac705-873b-4afc-a29d-f0adb89ccf5c/oauth2/v2.0/token',
    scope: 'abae5dfa-65e6-47c1-82ec-a54a8a3213b9/.default',
  },
} as const

export type B3Config = Readonly<{
  environment: 'certification' | 'production'
  apiBaseUrl: string
  optInUrl: string
  allowedHosts: readonly string[]
  secretsDir: string | null
  oauthTokenUrl: string
  oauthScope: string
  httpTimeoutMs: number
  allowInMemory: boolean
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
  rateLimitKeySecret: string
  cronSecret: string | null
  b3: B3Config
}>

function resolveRuntimeDatabaseUrl(
  raw: z.infer<typeof rawConfigSchema>,
): string | undefined {
  return raw.DATABASE_URL ?? raw.SUPABASE_POSTGRES_URL ?? raw.POSTGRES_URL
}

function resolveMigrationDatabaseUrl(
  raw: z.infer<typeof rawConfigSchema>,
): string | undefined {
  return (
    raw.DATABASE_MIGRATION_URL ??
    raw.SUPABASE_POSTGRES_URL_NON_POOLING ??
    raw.POSTGRES_URL_NON_POOLING
  )
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
        .map((host) => host.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]

  if (optInUrl.protocol !== 'https:') {
    throw new Error('B3_OPT_IN_URL must use HTTPS')
  }

  if (!allowedHosts.includes(optInUrl.hostname.toLowerCase())) {
    throw new Error('B3_OPT_IN_URL hostname is not allowed')
  }

  const apiBaseUrlRaw =
    raw.B3_API_BASE_URL ?? B3_API_BASE_BY_ENVIRONMENT[environment]
  const apiBaseUrl = new URL(apiBaseUrlRaw)

  if (apiBaseUrl.protocol !== 'https:') {
    throw new Error('B3_API_BASE_URL must use HTTPS')
  }

  const secretsDir = raw.B3_SECRETS_DIR?.trim() || null
  const oauthDefaults = B3_OAUTH_BY_ENVIRONMENT[environment]

  return Object.freeze({
    environment,
    apiBaseUrl: apiBaseUrl.origin,
    optInUrl: optInUrl.toString(),
    allowedHosts: Object.freeze(allowedHosts),
    secretsDir,
    oauthTokenUrl: raw.B3_OAUTH_TOKEN_URL?.trim() || oauthDefaults.tokenUrl,
    oauthScope: raw.B3_OAUTH_SCOPE?.trim() || oauthDefaults.scope,
    httpTimeoutMs: raw.B3_HTTP_TIMEOUT_MS ?? 30_000,
    allowInMemory: raw.B3_ALLOW_INMEMORY === '1',
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
    resolveRuntimeDatabaseUrl(rawConfig) ?? (isTest ? TEST_DATABASE_URL : undefined)
  const databaseMigrationUrl =
    resolveMigrationDatabaseUrl(rawConfig) ?? (isTest ? TEST_DATABASE_URL : undefined)

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL (or SUPABASE_POSTGRES_URL / POSTGRES_URL) is required',
    )
  }

  if (!databaseMigrationUrl) {
    throw new Error(
      'DATABASE_MIGRATION_URL (or SUPABASE_POSTGRES_URL_NON_POOLING / POSTGRES_URL_NON_POOLING) is required',
    )
  }

  const rateLimitKeySecret =
    rawConfig.RATE_LIMIT_KEY_SECRET ??
    (isTest || rawConfig.NODE_ENV === 'development'
      ? 'local-rate-limit-key-secret-change-before-production'
      : undefined)
  if (!rateLimitKeySecret) {
    throw new Error('RATE_LIMIT_KEY_SECRET is required in production')
  }
  if (
    rawConfig.NODE_ENV === 'production' &&
    /change-me|example|local-rate-limit/i.test(rateLimitKeySecret)
  ) {
    throw new Error('RATE_LIMIT_KEY_SECRET must not use a placeholder value')
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
    rateLimitKeySecret,
    cronSecret: rawConfig.CRON_SECRET?.trim() || null,
    b3: parseB3Config(rawConfig),
  })
}
