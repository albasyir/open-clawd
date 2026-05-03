import { AgentError } from 'clawpro-agent'

const STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  INVALID_INPUT: 400,
  UPSTREAM_ERROR: 502
}

export default defineEventHandler(async () => {
  try {
    return await skillManager.listInstalled()
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
