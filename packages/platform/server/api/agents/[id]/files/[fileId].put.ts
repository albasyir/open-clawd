import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id, fileId } = await getValidatedRouterParams(event, z.object({
    id: slugSchema,
    fileId: z.string().min(1),
  }).parse)

  const body = await readValidatedBody(event, z.object({ content: z.string() }).parse)

  try {
    agentManager.updateAgentFile(id, fileId, body.content)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
