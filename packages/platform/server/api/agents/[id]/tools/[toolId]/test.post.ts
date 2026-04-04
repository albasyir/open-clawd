import { z } from 'zod'

const testBodySchema = z.object({
  input: z.record(z.string(), z.unknown()),
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
  const parseResult = testBodySchema.safeParse(rawBody)
  if (!parseResult.success) {
    throw createError({ statusCode: 400, message: parseResult.error.message })
  }

  try {
    return await toolManager.testForAgent(agentId, toolId, parseResult.data.input)
  } catch (err) {
    throwAgentError(err)
  }
})
