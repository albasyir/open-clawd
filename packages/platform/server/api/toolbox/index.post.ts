import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, z.object({
    name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Name must be letters, numbers, hyphen or underscore only'),
  }).parse)

  try {
    return toolManager.createGlobal(body.name)
  } catch (err) {
    throwAgentError(err)
  }
})
