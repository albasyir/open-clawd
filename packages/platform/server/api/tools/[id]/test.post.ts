import { z } from 'zod'

const testBodySchema = z.object({
  input: z.record(z.string(), z.unknown()),
})

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9-]+$/i.test(id)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const rawBody = await readBody(event)
  const parseResult = testBodySchema.safeParse(rawBody)
  if (!parseResult.success) {
    throw createError({ statusCode: 400, message: parseResult.error.message })
  }

  return toolManager.testGlobal(id, parseResult.data.input)
})
