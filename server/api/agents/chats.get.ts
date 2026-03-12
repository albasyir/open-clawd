import { agentIds } from '../../agentic-system/agents/registry'

function displayName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
}

export default eventHandler(async () => {
  const now = new Date().toISOString()

  return agentIds.map((id) => ({
    id,
    agentId: id,
    agent: {
      name: displayName(id),
      avatar: { src: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(id)}` }
    },
    messages: [],
    updatedAt: now
  }))
})
