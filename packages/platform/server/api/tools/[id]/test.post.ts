import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { z } from 'zod'

const testBodySchema = z.object({
  input: z.record(z.string(), z.unknown())
})

const toolPathLabel = (id: string) => `agent/tools/${id}.ts`

function formatError(id: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  const path = toolPathLabel(id)
  return stack ? `${message}\n\nAt:\n${stack}` : `In ${path}: ${message}`
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9-]+$/i.test(id)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const rawBody = await readBody(event)
  const parseResult = testBodySchema.safeParse(rawBody)
  if (!parseResult.success) {
    throw createError({ statusCode: 400, message: parseResult.error.message })
  }
  const { input } = parseResult.data

  const path = toolPathLabel(id)
  const absolutePath = join(AGENT_DIR, 'tools', `${id}.ts`)
  const toolUrl = pathToFileURL(absolutePath).href + `?t=${Date.now()}`

  try {
    const mod = await import(toolUrl)
    const tool = mod.default

    if (tool === undefined || tool === null) {
      return {
        success: false,
        error: `In ${path}: No default export.`
      }
    }

    if (typeof tool.invoke !== 'function') {
      return {
        success: false,
        error: `In ${path}: Tool does not expose invoke().`
      }
    }

    const result = await tool.invoke(input)
    return { success: true, result }
  } catch (err) {
    return {
      success: false,
      error: formatError(id, err)
    }
  }
})
