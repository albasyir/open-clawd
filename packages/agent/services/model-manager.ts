import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ModelInfo } from '../types'

export function createModelManager(baseDir: string) {
  const modelsDir = join(baseDir, 'models')

  return {
    list(): ModelInfo[] {
      try {
        return readdirSync(modelsDir)
          .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
          .sort()
          .map((file) => {
            const name = file.replace(/\.ts$/, '')
            let content: string | undefined
            try { content = readFileSync(join(modelsDir, file), 'utf-8') } catch {}
            return { id: name, name, content }
          })
      } catch {
        return []
      }
    },

    update(id: string, content: string): void {
      const filePath = join(modelsDir, `${id}.ts`)
      writeFileSync(filePath, content, 'utf-8')
    },
  }
}

export type ModelManager = ReturnType<typeof createModelManager>
