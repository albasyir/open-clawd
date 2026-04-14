import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id, toolId } = await getValidatedRouterParams(event, z.object({
    id: slugSchema,
    toolId: slugSchema,
  }).parse)

  try {
    toolManager.deleteForAgent(id, toolId)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
