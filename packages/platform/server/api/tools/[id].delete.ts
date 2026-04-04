import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler((event) => {
  const toolId = getRouterParam(event, 'id')
  if (!toolId || !/^[a-z0-9_-]+$/i.test(toolId)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const globalToolPath = join(AGENT_DIR, 'tools', `${toolId}.ts`)

  if (!existsSync(globalToolPath)) {
    throw createError({ statusCode: 404, message: `Global tool "${toolId}" not found` })
  }

  try {
    unlinkSync(globalToolPath)
    return { ok: true }
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Failed to delete global tool'
    })
  }
})
