import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    name: z.string().min(1).regex(/^[a-z0-9_-]+$/i, 'Use only letters, numbers, hyphen or underscore'),
    template: z.string().min(1).regex(/^[a-z0-9_-]+$/i, 'Invalid template id'),
  }).parse)

  try {
    return agentManager.createAgent(body.name, body.template)
  } catch (err) {
    throwAgentError(err)
  }
})
