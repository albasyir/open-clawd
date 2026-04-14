import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id, toolId } = await getValidatedRouterParams(event, z.object({
    id: slugSchema,
    toolId: slugSchema,
  }).parse)

  const body = await readValidatedBody(event, z.object({ content: z.string() }).parse)

  try {
    toolManager.updateForAgent(id, toolId, body.content)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
