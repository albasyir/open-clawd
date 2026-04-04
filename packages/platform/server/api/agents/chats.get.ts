import { agents } from 'clawpro-agent'

export default eventHandler(async () => {
  const now = new Date().toISOString()
  
  const result = Object.entries(agents).map(([id, data]) => {
    let name = id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
    if (data.identity?.name) {
      name = data.identity.name
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
  })

  return result
})
