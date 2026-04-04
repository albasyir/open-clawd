import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { createToolManager, createAgentManager, createModelManager } from 'clawpro-agent'

const _require = createRequire(join(process.cwd(), 'package.json'))
export const AGENT_DIR = dirname(_require.resolve('clawpro-agent/package.json'))

export const toolManager = createToolManager(AGENT_DIR)
export const agentManager = createAgentManager(AGENT_DIR)
export const modelManager = createModelManager(AGENT_DIR)
