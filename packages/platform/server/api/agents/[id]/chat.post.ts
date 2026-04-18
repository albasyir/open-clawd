import { z } from 'zod'
import { createAgentChatStreamResponse } from '../../../utils/agent-chat-stream'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({
    id: slugSchema,
  }).parse)

  const body = await readValidatedBody(event, z.object({
    thread_id: z.string().min(1, 'Request body must include thread_id.'),
    message: z.string().min(1, 'Request body message must be non-empty.').optional(),
    resume: z.object({
      decisions: z.array(z.union([
        z.object({ type: z.literal('approve') }),
        z.object({
          type: z.literal('edit'),
          editedAction: z.object({
            name: z.string().min(1),
            args: z.record(z.string(), z.unknown())
          })
        }),
        z.object({
          type: z.literal('reject'),
          message: z.string().optional()
        }),
        z.object({
          type: z.literal('comment'),
          message: z.string().min(1)
        }),
      ])).min(1)
    }).optional(),
    stream: z.boolean().optional(),
  }).refine(value => !!value.message !== !!value.resume, {
    message: 'Request body must include exactly one of message or resume.'
  }).parse)

  try {
    if (body.stream) {
      return createAgentChatStreamResponse(async (write: (chunk: unknown) => void) => {
        await agentManager.streamAgent(
          id,
          body.thread_id.trim(),
          body.resume ? { resume: body.resume } : { message: body.message!.trim() },
          write
        )
      })
    }

    if (body.resume) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Resume requests must use stream: true.'
      })
    }

    return await agentManager.invokeAgent(id, body.thread_id.trim(), body.message!.trim())
  } catch (err) {
    throwAgentError(err)
  }
})
