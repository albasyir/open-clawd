import { z } from 'zod'
import { createToolTestStreamResponse } from '../../../../utils/tool-test-stream'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: slugSchema }).parse)

  const body = await readValidatedBody(event, z.object({
    input: z.record(z.string(), z.unknown())
  }).parse)

  return createToolTestStreamResponse(async (write: (chunk: unknown) => void) => {
    await toolManager.streamTestGlobal(id, body.input, write)
  })
})
