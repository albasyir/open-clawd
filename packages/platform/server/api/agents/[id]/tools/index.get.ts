import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolFile } from '~/types'

export default defineEventHandler((event): ToolFile[] => {
  const agentId = getRouterParam(event, 'id')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }

  const toolsDir = join(AGENT_DIR, 'agents', agentId, 'tools')
  try {
    const allFiles = readdirSync(toolsDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .sort()

    return allFiles.map((file) => {
      const filePath = join(toolsDir, file)
      const isSymlink = (() => {
        try {
          return lstatSync(filePath).isSymbolicLink()
        } catch {
          return false
        }
      })()
      const name = file.replace(/\.ts$/, '')
      let content: string | undefined
      try {
        content = readFileSync(filePath, 'utf-8')
      } catch {
        content = undefined
      }
      return { id: name, name, content, symlink: isSymlink || undefined }
    })
  } catch {
    return []
  }
})
