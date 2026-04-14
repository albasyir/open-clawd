import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({
    id: slugSchema,
  }).parse)

  try {
    agentManager.deleteAgent(id)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
