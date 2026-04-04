import { lstatSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { z } from 'zod'

const testBodySchema = z.object({
  input: z.record(z.string(), z.unknown())
})

function toolPathLabel(agentId: string, toolId: string) {
  return `agent/agents/${agentId}/tools/${toolId}.ts`
}

function formatError(agentId: string, toolId: string, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack : undefined
  const path = toolPathLabel(agentId, toolId)
  return stack ? `${message}\n\nAt:\n${stack}` : `In ${path}: ${message}`
}

export default defineEventHandler(async (event) => {
  const agentId = getRouterParam(event, 'id')
  const toolId = getRouterParam(event, 'toolId')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }
  if (!toolId || !/^[a-z0-9-]+$/i.test(toolId)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const rawBody = await readBody(event)
  const parseResult = testBodySchema.safeParse(rawBody)
  if (!parseResult.success) {
    throw createError({ statusCode: 400, message: parseResult.error.message })
  }
  const { input } = parseResult.data

  const absolutePath = join(AGENT_DIR, 'agents', agentId, 'tools', `${toolId}.ts`)

  const stat = lstatSync(absolutePath, { throwIfNoEntry: false })
  if (stat?.isSymbolicLink()) {
    throw createError({ statusCode: 400, message: 'Cannot run test for a symlinked tool' })
  }

  const toolUrl = pathToFileURL(absolutePath).href + `?t=${Date.now()}`

  try {
    const mod = await import(toolUrl)
    const tool = mod.default

    if (tool === undefined || tool === null) {
      return {
        success: false,
        error: `In ${toolPathLabel(agentId, toolId)}: No default export.`
      }
    }

    if (typeof tool.invoke === 'function') {
      const result = await tool.invoke(input)
      return { success: true, result }
    }
    if (typeof tool === 'function') {
      const result = await tool(input)
      return { success: true, result }
    }

    return {
      success: false,
      error: `In ${toolPathLabel(agentId, toolId)}: Tool does not expose invoke() or is not callable.`
    }
  } catch (err) {
    return {
      success: false,
      error: formatError(agentId, toolId, err)
    }
  }
})
