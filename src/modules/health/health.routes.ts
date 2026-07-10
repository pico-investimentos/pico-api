import { Hono } from 'hono'

import type { AppBindings } from '../../shared/http/app-bindings.js'

type HealthDependencies = {
  now: () => Date
}

export function createHealthRoutes({ now }: HealthDependencies) {
  return new Hono<AppBindings>().get('/health', (c) => {
    return c.json({
      status: 'ok' as const,
      service: 'pico-investimentos-api',
      version: '0.1.0',
      timestamp: now().toISOString(),
    })
  })
}
