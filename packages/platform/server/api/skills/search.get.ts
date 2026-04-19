import { z } from 'zod'

const skillsSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(20)
})

const skillsSearchResultSchema = z.object({
  id: z.string().min(1),
  skillId: z.string().min(1),
  name: z.string().min(1),
  installs: z.number().int().nonnegative(),
  source: z.string().min(1)
})

const skillsSearchResponseSchema = z.object({
  query: z.string(),
  searchType: z.string().min(1),
  skills: z.array(skillsSearchResultSchema)
})

async function getUpstreamErrorMessage(response: Response) {
  const fallback = `Skills search API responded with ${response.status}`

  try {
    const text = await response.text()
    if (!text) return fallback

    const body = JSON.parse(text) as unknown
    if (body && typeof body === 'object') {
      const errorBody = body as { message?: unknown, error?: unknown, statusMessage?: unknown }
      const message = errorBody.message ?? errorBody.statusMessage ?? errorBody.error
      if (typeof message === 'string' && message) return message
    }

    return text
  } catch {
    return fallback
  }
}

export default defineEventHandler(async (event) => {
  const { q, limit } = await getValidatedQuery(event, skillsSearchQuerySchema.parse)

  const searchUrl = new URL('https://skills.sh/api/search')
  searchUrl.searchParams.set('q', q)
  searchUrl.searchParams.set('limit', limit.toString())

  let response: Response
  try {
    response = await fetch(searchUrl)
  } catch (err) {
    throw createError({
      statusCode: 502,
      message: err instanceof Error ? err.message : 'Unable to reach skills search API'
    })
  }

  if (!response.ok) {
    throw createError({
      statusCode: response.status,
      message: await getUpstreamErrorMessage(response)
    })
  }

  let rawPayload: unknown
  try {
    rawPayload = await response.json()
  } catch {
    throw createError({
      statusCode: 502,
      message: 'Skills search API returned invalid JSON'
    })
  }

  const payload = skillsSearchResponseSchema.safeParse(rawPayload)
  if (!payload.success) {
    throw createError({
      statusCode: 502,
      message: 'Skills search API returned an unexpected response'
    })
  }

  if (payload.data.query !== q) {
    throw createError({
      statusCode: 502,
      message: 'Skills search API returned a mismatched query'
    })
  }

  return {
    searchType: payload.data.searchType,
    skills: payload.data.skills
  }
})
