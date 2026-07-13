import { loadEnvFile } from 'node:process'

import { hashPassword } from '../src/shared/crypto/security.js'
import { createDatabaseClient } from '../src/shared/database/client.js'
import { users } from '../src/shared/database/schema/index.js'
import { loadConfig } from '../src/config/env.js'

try {
  loadEnvFile('.env')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw error
  }
}

async function main() {
  const config = loadConfig()
  const email = (process.env.SEED_USER_EMAIL ?? 'cliente@pico.test').toLowerCase()
  const password = process.env.SEED_USER_PASSWORD ?? 'password123'
  const cpf = process.env.SEED_USER_CPF ?? '33433637822'

  const client = createDatabaseClient(config.databaseUrl)

  try {
    await client.db
      .insert(users)
      .values({
        email,
        passwordHash: await hashPassword(password),
        cpf,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          passwordHash: await hashPassword(password),
          cpf,
          isActive: true,
          updatedAt: new Date(),
        },
      })

    console.log(`Seeded user ${email}`)
  } finally {
    await client.close()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
