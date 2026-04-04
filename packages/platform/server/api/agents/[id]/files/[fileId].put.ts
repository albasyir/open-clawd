import { z } from 'zod'

const putFileBodySchema = z.object({ content: z.string() })

export default defineEventHandler(async (event) => {
  const agentId = getRouterParam(event, 'id')
  const fileId = getRouterParam(event, 'fileId')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }
  if (!fileId) {
    throw createError({ statusCode: 400, message: 'Invalid file id' })
  }

  const rawBody = await readBody(event)
  const result = putFileBodySchema.safeParse(rawBody)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.error.message })
  }

  try {
    agentManager.updateAgentFile(agentId, fileId, result.data.content)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
