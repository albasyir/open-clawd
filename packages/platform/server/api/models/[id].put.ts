import { z } from 'zod'

const putModelBodySchema = z.object({ content: z.string() })

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9_-]+$/i.test(id)) {
    throw createError({ statusCode: 400, message: 'Invalid model id' })
  }

  const rawBody = await readBody(event)
  const result = putModelBodySchema.safeParse(rawBody)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.error.message })
  }

  try {
    modelManager.update(id, result.data.content)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
