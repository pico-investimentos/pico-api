import { Hono } from 'hono'

import type { AppConfig } from './config/env.js'
import { createB3Routes } from './modules/b3/b3.routes.js'
import { createHealthRoutes } from './modules/health/health.routes.js'
import { createIdentityRoutes } from './modules/identity/identity.routes.js'
import type { AppServices } from './shared/app-services.js'
import type { AppBindings } from './shared/http/app-bindings.js'






type ApiDependencies = {
  config: AppConfig
  now: () => Date
  services: AppServices
}

export function createApiRoutes(dependencies: ApiDependencies) {
  return new Hono<AppBindings>()
    .route('/', createHealthRoutes({ now: dependencies.now }))
    .route(
      '/',
      createIdentityRoutes({
        config: dependencies.config,
        now: dependencies.now,
        loginUser: dependencies.services.loginUser,
        logoutUser: dependencies.services.logoutUser,
        resolveSession: dependencies.services.resolveSession,
      }),
    )
    .route(
      '/',
      createB3Routes({
        config: dependencies.config,
        now: dependencies.now,
        resolveSession: dependencies.services.resolveSession,
        startB3Authorization: dependencies.services.startB3Authorization,
      }),
    )
}
