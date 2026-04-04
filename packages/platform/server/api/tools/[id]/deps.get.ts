import { existsSync, lstatSync, readdirSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'

export default defineEventHandler((event) => {
  const toolId = getRouterParam(event, 'id')
  if (!toolId || !/^[a-z0-9_-]+$/i.test(toolId)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  const globalToolPath = join(AGENT_DIR, 'tools', `${toolId}.ts`)
  if (!existsSync(globalToolPath)) {
    throw createError({ statusCode: 404, message: `Global tool "${toolId}" not found` })
  }

  const agentsDir = join(AGENT_DIR, 'agents')
  const deps: { agentId: string; toolName: string }[] = []

  if (!existsSync(agentsDir)) return { deps }

  try {
    const agents = readdirSync(agentsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)

    for (const agentId of agents) {
      const toolsDir = join(agentsDir, agentId, 'tools')
      if (!existsSync(toolsDir)) continue

      const toolFiles = readdirSync(toolsDir, { withFileTypes: true })
      for (const file of toolFiles) {
        if (!file.name.endsWith('.ts')) continue

        const filePath = join(toolsDir, file.name)
        const stat = lstatSync(filePath)

        if (stat.isSymbolicLink()) {
          const target = readlinkSync(filePath)
          const isTargetMatch = target.endsWith(`/${toolId}.ts`) || target.endsWith(`\\${toolId}.ts`)
          
          if (isTargetMatch) {
            deps.push({
              agentId,
              toolName: file.name.replace(/\.ts$/, '')
            })
          }
        }
      }
    }

    return { deps }
  } catch (err: any) {
    if (err?.statusCode) throw err
    throw createError({
      statusCode: 500,
      message: err instanceof Error ? err.message : 'Failed to check tool dependencies'
    })
  }
})
