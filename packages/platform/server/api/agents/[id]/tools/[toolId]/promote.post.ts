import { z } from 'zod'

const promoteBodySchema = z.object({
  globalName: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Name must be letters, numbers, hyphen or underscore only').optional(),
})

export default defineEventHandler(async (event) => {
  const agentId = getRouterParam(event, 'id')
  const toolId = getRouterParam(event, 'toolId')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }
  if (!toolId || !/^[a-z0-9_-]+$/i.test(toolId)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const rawBody = await readBody(event)
  const parsed = promoteBodySchema.safeParse(rawBody ?? {})
  if (!parsed.success) {
    const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ')
    throw createError({ statusCode: 400, message: msg })
  }

  try {
    return toolManager.promoteForAgent(agentId, toolId, parsed.data.globalName)
  } catch (err) {
    throwAgentError(err)
  }
})
