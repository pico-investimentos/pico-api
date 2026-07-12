import type { Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'

import type { AppConfig } from '../../config/env.js'
import type { AppBindings } from '../http/app-bindings.js'

export function setSessionCookie(
  c: Context<AppBindings>,
  config: AppConfig,
  sessionToken: string,
  expiresAt: Date,
) {
  setCookie(c, config.sessionCookieName, sessionToken, {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  })
}

export function clearSessionCookie(c: Context<AppBindings>, config: AppConfig) {
  deleteCookie(c, config.sessionCookieName, {
    path: '/',
    secure: config.nodeEnv === 'production',
    sameSite: 'Lax',
  })
}
