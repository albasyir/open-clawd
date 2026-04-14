import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id, toolId } = await getValidatedRouterParams(event, z.object({
    id: slugSchema,
    toolId: slugSchema,
  }).parse)

  const body = await readValidatedBody(event, z.object({
    globalName: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Name must be letters, numbers, hyphen or underscore only').optional(),
  }).parse)

  try {
    return toolManager.promoteForAgent(id, toolId, body.globalName)
  } catch (err) {
    throwAgentError(err)
  }
})
