import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: slugSchema }).parse)

  const body = await readValidatedBody(event, z.object({
    input: z.record(z.string(), z.unknown()),
  }).parse)

  return toolManager.testGlobal(id, body.input)
})
