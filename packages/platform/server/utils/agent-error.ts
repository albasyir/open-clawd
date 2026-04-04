import { AgentError } from 'clawpro-agent'

export function throwAgentError(err: unknown): never {
  if (err instanceof AgentError) {
    throw createError({ statusCode: err.statusCode, message: err.message })
  }
  throw createError({
    statusCode: 500,
    message: err instanceof Error ? err.message : 'Internal server error',
  })
}
