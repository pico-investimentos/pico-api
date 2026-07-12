import type { RequestIdVariables } from 'hono/request-id'

import type { AuthenticatedUser } from '../domain/types.js'

export type AppBindings = {
  Variables: RequestIdVariables & {
    user?: AuthenticatedUser
  }
}
