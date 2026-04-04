import { z } from 'zod'

const putToolBodySchema = z.object({ content: z.string() })

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

  try {
    toolManager.updateForAgent(agentId, toolId, result.data.content)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
