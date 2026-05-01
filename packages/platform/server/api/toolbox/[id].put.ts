import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: slugSchema }).parse)
  const body = await readValidatedBody(event, z.object({
    content: z.string(),
    file: z.enum(['tool.ts', 'interrupt.ts']).optional(),
  }).parse)

  try {
    toolManager.updateGlobal(id, body.content, body.file)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
