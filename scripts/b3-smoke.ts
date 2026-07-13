import { loadEnvFile } from 'node:process'

import { loadConfig } from '../src/config/env.js'
import { normalizeCpf } from '../src/shared/crypto/security.js'
import {
  HttpB3InvestorAuthorizationClient,
} from '../src/modules/b3/infrastructure/b3-investor-authorization-client.js'
import { loadB3AccessSecrets } from '../src/modules/b3/infrastructure/load-b3-secrets.js'

try {
  loadEnvFile('.env')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw error
  }
}

function readCpfArg(argv: string[]): string | null {
  const flag = argv.find((arg) => arg.startsWith('--cpf='))
  return flag ? normalizeCpf(flag.slice('--cpf='.length)) : null
}

async function main() {
  const config = loadConfig()

  if (!config.b3.secretsDir) {
    throw new Error('B3_SECRETS_DIR is required for b3:smoke')
  }

  const cpf = readCpfArg(process.argv.slice(2))
  const secrets = loadB3AccessSecrets(config.b3.secretsDir)
  const client = new HttpB3InvestorAuthorizationClient(config.b3, secrets)

  console.log(
    JSON.stringify({
      event: 'b3_smoke_start',
      environment: config.b3.environment,
      apiBaseUrl: config.b3.apiBaseUrl,
    }),
  )

  const health = await client.healthcheck()
  console.log(
    JSON.stringify({
      event: 'b3_smoke_healthcheck',
      ok: health.ok,
      status: health.status,
    }),
  )

  if (!health.ok) {
    process.exitCode = 1
    return
  }

  if (!cpf) {
    console.log(
      JSON.stringify({
        event: 'b3_smoke_skip_lookup',
        reason: 'pass --cpf=########### to query authorizations',
      }),
    )
    return
  }

  const lookup = await client.findAuthorizationsByDocument(cpf)
  const matched = lookup.authorizedInvestors.some(
    (investor) => normalizeCpf(investor.documentNumber) === cpf,
  )

  console.log(
    JSON.stringify({
      event: 'b3_smoke_authorization_lookup',
      matched,
      count: lookup.authorizedInvestors.length,
    }),
  )
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'b3_smoke_failed',
      message: error instanceof Error ? error.message : 'unknown_error',
    }),
  )
  process.exitCode = 1
})
