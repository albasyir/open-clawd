import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelFile } from '~/types'

export default defineEventHandler((): ModelFile[] => {
  const modelsDir = join(process.cwd(), 'server', 'agentic-system', 'models')
  try {
    const files = readdirSync(modelsDir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .sort()

    return files.map((file) => {
      const name = file.replace(/\.ts$/, '')
      let content: string | undefined
      try {
        content = readFileSync(join(modelsDir, file), 'utf-8')
      } catch {
        content = undefined
      }
      return {
        id: name,
        name,
        content
      }
    })
  } catch {
    return []
  }
})
