import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: slugSchema }).parse)

  const body = await readValidatedBody(event, z.object({
    name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Name must be letters, numbers, hyphen or underscore only'),
    linkGlobal: z.boolean().optional(),
  }).parse)

  try {
    return toolManager.createForAgent(id, body.name, { linkGlobal: body.linkGlobal })
  } catch (err) {
    throwAgentError(err)
  }
})
