import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function toolNameToVar(name: string): string {
  const camel = name
    .split(/[-_]/)
    .map((part, i) => (i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join('')
  return `${camel}Tool`
}

function removeToolFromAgentFile(agentId: string, toolName: string): void {
  const agentDir = join(process.cwd(), 'server', 'agentic-system', 'agents', agentId)
  const agentPath = join(agentDir, `${agentId}.agent.ts`)
  if (!existsSync(agentPath)) return

  const varName = toolNameToVar(toolName)
  let content = readFileSync(agentPath, 'utf-8')

  const lines = content.split('\n')
  const newLines = lines.filter((line) => {
    if (/from\s+['"]\.\/tools\//.test(line) && line.includes(`${varName}`)) return false
    return true
  })
  content = newLines.join('\n')

  const toolsArrayRegex = /(tools:\s*\[)([\s\S]*?)(\],)/
  const match = content.match(toolsArrayRegex)
  if (match) {
    const inner = match[2]!.trim()
    const newInner = inner
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== varName)
      .join(', ')
    content = content.replace(toolsArrayRegex, `$1${newInner}$3`)
  }

  writeFileSync(agentPath, content, 'utf-8')
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
    removeToolFromAgentFile(agentId, toolId)
    return { ok: true }
  } catch (err: any) {
    throw createError({
      statusCode: 500,
      message: err?.message ?? 'Failed to remove tool'
    })
  }
})
