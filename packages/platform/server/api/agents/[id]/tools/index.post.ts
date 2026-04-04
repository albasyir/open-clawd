import { z } from 'zod'

const createToolBodySchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Name must be letters, numbers, hyphen or underscore only'),
  linkGlobal: z.boolean().optional(),
})

export default defineEventHandler(async (event) => {
  const agentId = getRouterParam(event, 'id')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }

  const rawBody = await readBody(event)
  const result = createToolBodySchema.safeParse(rawBody)
  if (!result.success) {
    const msg = result.error.issues.map((e: { message: string }) => e.message).join('; ')
    throw createError({ statusCode: 400, message: msg })
  }

  try {
    return toolManager.createForAgent(agentId, result.data.name, { linkGlobal: result.data.linkGlobal })
  } catch (err) {
    throwAgentError(err)
  }
})
