import { scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import {
  hashPassword,
  verifyPassword,
} from '../src/shared/crypto/security.js'
import { createMemoryServices } from '../src/shared/app-services.js'
import { InMemoryUserRepository } from '../src/shared/database/memory-repositories.js'
import { createTestApp, testConfig } from './app.test.js'

const scrypt = promisify(scryptCallback)
const userId = '11111111-1111-1111-1111-111111111111'

async function login(
  app: ReturnType<typeof createTestApp>,
  password: string,
) {
  return app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
      'X-Forwarded-For': '203.0.113.10',
    },
    body: JSON.stringify({
      email: 'cliente@pico.test',
      password,
    }),
  })
}

describe('authentication security', () => {
  it('stores new passwords as Argon2id hashes', async () => {
    const passwordHash = await hashPassword('password123')

    expect(passwordHash).toMatch(/^\$argon2id\$/)
    await expect(verifyPassword('password123', passwordHash)).resolves.toBe(true)
    await expect(verifyPassword('wrong-password', passwordHash)).resolves.toBe(
      false,
    )
  })

  it('rate-limits repeated login guesses by account before verification', async () => {
    const services = createMemoryServices(testConfig)
    const users = services.users as InMemoryUserRepository
    users.seed({
      id: userId,
      email: 'cliente@pico.test',
      passwordHash: await hashPassword('password123'),
      cpf: null,
      isActive: true,
    })
    const app = createTestApp(services)

    for (let index = 0; index < 5; index += 1) {
      expect((await login(app, 'wrong-password')).status).toBe(401)
    }

    const blocked = await login(app, 'wrong-password')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).toBe('1800')
    expect(await blocked.json()).toMatchObject({
      error: { code: 'RATE_LIMITED' },
    })
  })

  it('upgrades a legacy scrypt hash after successful login', async () => {
    const services = createMemoryServices(testConfig)
    const users = services.users as InMemoryUserRepository
    const salt = '00112233445566778899aabbccddeeff'
    const derived = (await scrypt('password123', salt, 64)) as Buffer
    users.seed({
      id: userId,
      email: 'cliente@pico.test',
      passwordHash: `${salt}:${derived.toString('hex')}`,
      cpf: null,
      isActive: true,
    })
    const app = createTestApp(services)

    expect((await login(app, 'password123')).status).toBe(200)
    expect((await users.findById(userId))?.passwordHash).toMatch(
      /^\$argon2id\$/,
    )
  })
})
