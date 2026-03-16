import { existsSync, lstatSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler((event) => {
  const agentId = getRouterParam(event, 'id')
  const toolId = getRouterParam(event, 'toolId')

  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }
  if (!toolId || !/^[a-z0-9_-]+$/i.test(toolId)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const toolPath = join(process.cwd(), 'server', 'agentic-system', 'agents', agentId, 'tools', `${toolId}.ts`)

  if (!existsSync(toolPath)) {
    throw createError({ statusCode: 404, message: `Tool "${toolId}" not found` })
  }

  try {
    const stat = lstatSync(toolPath)
    if (!stat.isSymbolicLink()) {
      throw createError({ statusCode: 400, message: `Tool "${toolId}" is already a local file` })
    }
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({ statusCode: 500, message: 'Failed to check tool status' })
  }

  try {
    // Read the real file content through the symlink before removing it
    const content = readFileSync(toolPath, 'utf-8')

    // Remove the symlink
    unlinkSync(toolPath)

    // Write the content as a real file
    writeFileSync(toolPath, content, 'utf-8')

    return { id: toolId, name: toolId, symlink: false, content }
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Failed to copy tool'
    })
  }
})
