import { z } from 'zod'

const createAgentSchema = z.object({
  name: z.string().min(1).regex(/^[a-z0-9_-]+$/i, 'Use only letters, numbers, hyphen or underscore'),
  template: z.string().min(1).regex(/^[a-z0-9_-]+$/i, 'Invalid template id'),
})

export default defineEventHandler(async (event) => {
  const rawBody = await readBody(event)
  const result = createAgentSchema.safeParse(rawBody)
  if (!result.success) {
    throw createError({ statusCode: 400, message: result.error.issues[0]?.message || 'Invalid input' })
  }
  try {
    return agentManager.createAgent(result.data.name, result.data.template)
  } catch (err) {
    throwAgentError(err)
  }
})
