import { AgentError } from 'clawpro-agent'
import { z } from 'zod'

const githubRepoSchema = z.string().regex(/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i)
const skillIdSchema = z.string().regex(/^[a-z0-9_.-]+$/i)

const skillSchema = z.object({
  id: z.string().min(1),
  skillId: skillIdSchema,
  source: githubRepoSchema
}).refine(value => value.id === `${value.source}/${value.skillId}`, {
  message: 'Skill id must match source and skillId'
})

const installationSchema = z.object({
  skills: z.array(skillSchema).max(100)
})

const STATUS_MAP: Record<string, number> = {
  NOT_FOUND: 404,
  ALREADY_EXISTS: 409,
  INVALID_INPUT: 400,
  UPSTREAM_ERROR: 502
}

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, installationSchema.parse)

  try {
    const skills = await skillManager.checkSkillInstallation(body.skills)
    return { skills }
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
