import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id, toolId } = await getValidatedRouterParams(event, z.object({
    id: slugSchema,
    toolId: slugSchema,
  }).parse)

  try {
    return toolManager.copyForAgent(id, toolId)
  } catch (err) {
    throwAgentError(err)
  }
})
