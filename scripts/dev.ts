import { serve } from '@hono/node-server'
import { loadEnvFile } from 'node:process'

import { createApp } from '../src/app.js'
import { loadConfig } from '../src/config/env.js'

try {
  loadEnvFile('.env')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw error
  }
}

const config = loadConfig()
const app = createApp({ config })

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (serverInfo) => {
    console.info(
      JSON.stringify({
        level: 'info',
        event: 'server_started',
        address: `http://localhost:${serverInfo.port}`,
      }),
    )
  },
)
