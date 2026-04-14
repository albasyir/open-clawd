import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id, toolId } = await getValidatedRouterParams(event, z.object({
    id: slugSchema,
    toolId: slugSchema,
  }).parse)

  const body = await readValidatedBody(event, z.object({
    input: z.record(z.string(), z.unknown()),
  }).parse)

  try {
    return await toolManager.testForAgent(id, toolId, body.input)
  } catch (err) {
    throwAgentError(err)
  }
})
