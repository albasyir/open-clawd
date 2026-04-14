import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

let _baseDir: string | undefined

export function resolveBaseDir(): string {
  if (_baseDir) return _baseDir

  try {
    const _require = createRequire(join(process.cwd(), 'package.json'))
    _baseDir = dirname(_require.resolve('clawpro-agent/package.json'))
  } catch {
    _baseDir = resolve(import.meta.dirname, '..')
  }

  return _baseDir
}
