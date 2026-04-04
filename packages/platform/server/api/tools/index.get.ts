import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolFile } from '~/types'

export default defineEventHandler((): ToolFile[] => {
  const toolsDir = join(AGENT_DIR, 'tools')
  try {
    const files = readdirSync(toolsDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .sort()

    return files.map((file) => {
      const name = file.replace(/\.ts$/, '')
      let content: string | undefined
      try {
        content = readFileSync(join(toolsDir, file), 'utf-8')
      } catch {
        content = undefined
      }
      return {
        id: name,
        name,
        content,
      }
    })
  } catch {
    return []
  }
})
