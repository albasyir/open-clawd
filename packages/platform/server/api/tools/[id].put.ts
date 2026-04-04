import { z } from 'zod'

const putToolBodySchema = z.object({ content: z.string() })

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

  try {
    toolManager.updateGlobal(id, result.data.content)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
