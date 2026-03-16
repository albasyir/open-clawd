import { readdirSync } from 'node:fs'
import { join } from 'node:path'

export default eventHandler(async () => {
  const now = new Date().toISOString()
  const agentsDir = join(process.cwd(), 'server', 'agentic-system', 'agents')
  
  let agentIds: string[] = []
  try {
    agentIds = readdirSync(agentsDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory() && !dirent.name.startsWith('.'))
      .map((dirent) => dirent.name)
  } catch {
    // Ignore if directory doesn't exist
  }

  const agents = await Promise.all(agentIds.map(async (id) => {
    let name = id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
    try {
      // Use dynamic import to read the identity of the agent.
      const identityModule = await import(`../../agentic-system/agents/${id}/identity.ts`)
      if (identityModule?.default?.name) {
        name = identityModule.default.name
      }
    } catch {
      // Fallback to the generated name if identity.ts is not found or fails
    }

    return {
      id,
      agentId: id,
      agent: {
        name,
        avatar: { src: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(id)}` }
      },
      messages: [],
      updatedAt: now
    }
  }))

  return agents
})
