import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Remove a dynamic import entry from the agent's tool.ts file. */
function removeFromToolFile(agentId: string, toolName: string): void {
  const agentDir = join(process.cwd(), 'server', 'agentic-system', 'agents', agentId)
  const toolFilePath = join(agentDir, 'tool.ts')
  if (!existsSync(toolFilePath)) return

  let content = readFileSync(toolFilePath, 'utf-8')

  // Remove the line containing the dynamic import for this tool
  const lines = content.split('\n')
  const filtered = lines.filter((line) => !line.includes(`'./tools/${toolName}'`))
  content = filtered.join('\n')

  writeFileSync(toolFilePath, content, 'utf-8')
}

export default defineEventHandler((event) => {
  const agentId = getRouterParam(event, 'id')
  const toolId = getRouterParam(event, 'toolId')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }
  if (!toolId || !/^[a-z0-9_-]+$/i.test(toolId)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const toolsDir = join(process.cwd(), 'server', 'agentic-system', 'agents', agentId, 'tools')
  const filePath = join(toolsDir, `${toolId}.ts`)

  if (!existsSync(filePath)) {
    throw createError({ statusCode: 404, message: `Tool "${toolId}" not found` })
  }

  try {
    unlinkSync(filePath)
    removeFromToolFile(agentId, toolId)
    return { ok: true }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      message: err?.message ?? 'Failed to remove tool'
    })
  }
})
