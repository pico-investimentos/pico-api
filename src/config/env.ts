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
})

const originSchema = z.string().url().transform((value) => new URL(value).origin)

export type AppConfig = Readonly<{
  nodeEnv: 'development' | 'test' | 'production'
  port: number
  appOrigins: readonly string[]
  logLevel: 'info' | 'silent'
}>

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): AppConfig {
  const rawConfig = rawConfigSchema.parse(environment)
  const originCandidates = rawConfig.APP_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  const origins = z.array(originSchema).min(1).parse(originCandidates)

  return Object.freeze({
    nodeEnv: rawConfig.NODE_ENV,
    port: rawConfig.PORT,
    appOrigins: Object.freeze([...new Set(origins)]),
    logLevel: rawConfig.LOG_LEVEL,
  })
}
