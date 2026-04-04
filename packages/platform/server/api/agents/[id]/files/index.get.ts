import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolFile } from '~/types'

export default defineEventHandler((event): ToolFile[] => {
  const agentId = getRouterParam(event, 'id')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }

  const agentDir = join(AGENT_DIR, 'agents', agentId)
  const allowedFiles = ['agent.ts', 'memory.ts', 'model.ts', 'identity.ts', 'soul.md']

  return allowedFiles.map((file) => {
    const filePath = join(agentDir, file)
    let name = file
    if (name.endsWith('.ts')) name = name.slice(0, -3)
    if (name.endsWith('.md')) name = name.slice(0, -3)

    let content: string | undefined
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      if (file === 'soul.md') {
        content = 'Now you are agent for user, soon or leter you become someone'
      } else {
        content = undefined
      }
    }
    return { id: file, name, content, symlink: false }
  }).filter(f => f.content !== undefined) // Only return files that exist
})
