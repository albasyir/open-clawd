import { lstatSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const putToolBodySchema = z.object({
  content: z.string()
})

export default defineEventHandler(async (event) => {
  const agentId = getRouterParam(event, 'id')
  const toolId = getRouterParam(event, 'toolId')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }
  if (!toolId || !/^[a-z0-9-]+$/i.test(toolId)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const rawBody = await readBody(event)
  const result = putToolBodySchema.safeParse(rawBody)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.error.message })
  }
  const body = result.data

  const filePath = join(AGENT_DIR, 'agents', agentId, 'tools', `${toolId}.ts`)

  try {
    const stat = lstatSync(filePath, { throwIfNoEntry: false })
    if (stat?.isSymbolicLink()) {
      throw createError({ statusCode: 400, message: 'Cannot edit a symlinked tool' })
    }
    writeFileSync(filePath, body.content, 'utf-8')
    return { ok: true }
  } catch (err) {
    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Failed to save file'
    })
  }
})
