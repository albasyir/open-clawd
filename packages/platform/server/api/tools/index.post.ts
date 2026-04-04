import { z } from 'zod'

const createToolBodySchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Name must be letters, numbers, hyphen or underscore only'),
})

export default defineEventHandler(async (event) => {
  const rawBody = await readBody(event)
  const result = createToolBodySchema.safeParse(rawBody)
  if (!result.success) {
    const msg = result.error.errors.map((e) => e.message).join('; ')
    throw createError({ statusCode: 400, message: msg })
  }

  try {
    return toolManager.createGlobal(result.data.name)
  } catch (err) {
    throwAgentError(err)
  }
})
