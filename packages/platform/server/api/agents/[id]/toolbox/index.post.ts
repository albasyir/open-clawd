import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: slugSchema }).parse)

  const body = await readValidatedBody(event, z.object({
    toolName: z.string().min(1).max(64),
  }).parse)

  try {
    toolManager.linkTool(id, body.toolName)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
