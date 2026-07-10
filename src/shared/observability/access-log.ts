import type { MiddlewareHandler } from 'hono'

import type { AppConfig } from '../../config/env.js'
import type { AppBindings } from '../http/app-bindings.js'

export function accessLog(config: AppConfig): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    if (config.logLevel === 'silent') {
      await next()
      return
    }

    const startedAt = performance.now()
    await next()

    const entry = JSON.stringify({
      level: c.res.status >= 500 ? 'error' : 'info',
      event: 'http_request',
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    })

    if (c.res.status >= 500) {
      console.error(entry)
      return
    }

    console.info(entry)
  }
}
