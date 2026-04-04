import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const GLOBAL_TOOLS_DIR = join(AGENT_DIR, 'tools')

const promoteBodySchema = z.object({
  globalName: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, 'Name must be letters, numbers, hyphen or underscore only').optional()
})

/** Rename a dynamic import entry in the agent's tool.ts file. */
function renameInToolFile(agentId: string, oldName: string, newName: string): void {
  const agentDir = join(AGENT_DIR, 'agents', agentId)
  const toolFilePath = join(agentDir, 'tool.ts')
  if (!existsSync(toolFilePath)) return

  let content = readFileSync(toolFilePath, 'utf-8')

  // Replace the old import path with the new one
  content = content.replace(
    `'./tools/${oldName}'`,
    `'./tools/${newName}'`
  )

  writeFileSync(toolFilePath, content, 'utf-8')
}

export default defineEventHandler(async (event) => {
  const agentId = getRouterParam(event, 'id')
  const toolId = getRouterParam(event, 'toolId')

  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }
  if (!toolId || !/^[a-z0-9_-]+$/i.test(toolId)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const rawBody = await readBody(event)
  const parsed = promoteBodySchema.safeParse(rawBody ?? {})
  if (!parsed.success) {
    const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ')
    throw createError({ statusCode: 400, message: msg })
  }

  const globalName = parsed.data.globalName || toolId
  const toolsDir = join(AGENT_DIR, 'agents', agentId, 'tools')
  const agentToolPath = join(toolsDir, `${toolId}.ts`)

  if (!existsSync(agentToolPath)) {
    throw createError({ statusCode: 404, message: `Tool "${toolId}" not found` })
  }

  // Must not already be a symlink
  try {
    if (lstatSync(agentToolPath).isSymbolicLink()) {
      throw createError({ statusCode: 400, message: `Tool "${toolId}" is already a global link` })
    }
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({ statusCode: 500, message: 'Failed to check tool status' })
  }

  // Check global tool doesn't already exist
  const globalToolPath = join(GLOBAL_TOOLS_DIR, `${globalName}.ts`)
  if (existsSync(globalToolPath)) {
    throw createError({ statusCode: 409, message: `A global tool named "${globalName}" already exists` })
  }

  try {
    // 1. Ensure global tools dir exists
    mkdirSync(GLOBAL_TOOLS_DIR, { recursive: true })

    // 2. Copy agent tool to global
    copyFileSync(agentToolPath, globalToolPath)

    // 3. Remove the agent's local file
    unlinkSync(agentToolPath)

    // 4. Create symlink with the global name
    const newSymlinkPath = join(toolsDir, `${globalName}.ts`)
    const relativeTarget = join('..', '..', '..', 'tools', `${globalName}.ts`)
    symlinkSync(relativeTarget, newSymlinkPath)

    // 5. Update agent file imports if the name changed
    if (globalName !== toolId) {
      renameInToolFile(agentId, toolId, globalName)
    }

    return { id: globalName, name: globalName, symlink: true }
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Failed to promote tool'
    })
  }
})

