import { AgentError } from 'clawpro-agent'
import type { AgentErrorCode } from 'clawpro-agent'

const STATUS_MAP: Record<AgentErrorCode, number> = {
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  INVALID_INPUT: 400,
}

export function throwAgentError(err: unknown): never {
  if (err instanceof AgentError) {
    throw createError({ statusCode: STATUS_MAP[err.code] ?? 500, message: err.message })
  }
  throw createError({
    statusCode: 500,
    message: err instanceof Error ? err.message : 'Internal server error',
  })
}
