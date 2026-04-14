import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: slugSchema }).parse)
  const body = await readValidatedBody(event, z.object({ content: z.string() }).parse)

  try {
    modelManager.update(id, body.content)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
