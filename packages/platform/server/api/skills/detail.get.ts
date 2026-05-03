import { AgentError } from 'clawpro-agent'
import { z } from 'zod'

const skillDetailQuerySchema = z.object({
  id: z.string().trim().min(1)
})

const STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  INVALID_INPUT: 400,
  UPSTREAM_ERROR: 502
}

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedQuery(event, skillDetailQuerySchema.parse)

  try {
    return await skillManager.getInstalled(id)
  } catch (err) {
    if (err instanceof AgentError) {
      throw createError({
        statusCode: err.statusCode ?? STATUS_MAP[err.code] ?? 500,
        message: err.message
      })
    }

    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Internal server error'
    })
  }
})
