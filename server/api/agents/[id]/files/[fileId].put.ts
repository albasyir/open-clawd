import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const putFileBodySchema = z.object({
  content: z.string()
})

const ALLOWED_FILES = ['agent.ts', 'memory.ts', 'model.ts', 'soul.md']

export default defineEventHandler(async (event) => {
  const agentId = getRouterParam(event, 'id')
  const fileId = getRouterParam(event, 'fileId')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }
  if (!fileId || !ALLOWED_FILES.includes(fileId)) {
    throw createError({ statusCode: 400, message: 'Invalid file id' })
  }

  const rawBody = await readBody(event)
  const result = putFileBodySchema.safeParse(rawBody)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.error.message })
  }
  const body = result.data

  const filePath = join(process.cwd(), 'server', 'agentic-system', 'agents', agentId, fileId)

  try {
    writeFileSync(filePath, body.content, 'utf-8')
    return { ok: true }
  } catch (err) {
    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Failed to save file'
    })
  }
})
