import { Hono } from 'hono'

import { createHealthRoutes } from './modules/health/health.routes.js'
import type { AppBindings } from './shared/http/app-bindings.js'

type ApiDependencies = {
  now: () => Date
}

export function createApiRoutes(dependencies: ApiDependencies) {
  return new Hono<AppBindings>().route('/', createHealthRoutes(dependencies))
}
