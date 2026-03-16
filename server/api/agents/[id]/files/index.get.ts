import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolFile } from '~/types'

export default defineEventHandler((event): ToolFile[] => {
  const agentId = getRouterParam(event, 'id')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }

  const agentDir = join(process.cwd(), 'server', 'agentic-system', 'agents', agentId)
  const allowedFiles = ['agent.ts', 'memory.ts', 'model.ts']

  return allowedFiles.map((file) => {
    const filePath = join(agentDir, file)
    const name = file.replace(/\.ts$/, '')
    let content: string | undefined
    try {
      content = readFileSync(filePath, 'utf-8')
    } catch {
      content = undefined
    }
    return { id: name, name, content, symlink: false }
  }).filter(f => f.content !== undefined) // Only return files that exist
})
