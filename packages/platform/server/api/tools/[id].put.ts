import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const putToolBodySchema = z.object({
  content: z.string()
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9-]+$/i.test(id)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const rawBody = await readBody(event)
  const result = putToolBodySchema.safeParse(rawBody)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.error.message })
  }
  const body = result.data

  const filePath = join(AGENT_DIR, 'tools', `${id}.ts`)

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
