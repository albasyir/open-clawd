import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({
    id: slugSchema,
  }).parse)

  const body = await readValidatedBody(event, z.object({
    thread_id: z.string().min(1, 'Request body must include thread_id.'),
    message: z.string().min(1, 'Request body must include message (non-empty string).'),
  }).parse)

  try {
    return await agentManager.invokeAgent(id, body.thread_id.trim(), body.message.trim())
  } catch (err) {
    throwAgentError(err)
  }
})
