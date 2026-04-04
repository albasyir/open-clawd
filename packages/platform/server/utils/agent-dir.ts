import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const _require = createRequire(join(process.cwd(), 'package.json'))
export const AGENT_DIR = dirname(_require.resolve('clawpro-agent/package.json'))
