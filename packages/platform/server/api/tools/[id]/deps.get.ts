import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: slugSchema }).parse)

  // Check which agents have this tool linked in their tool.ts
  const allAgents = agentManager.listAgents()
  const deps = allAgents
    .filter((agent) => toolManager.listLinkedTools(agent.agentId).includes(id))
    .map((agent) => ({ agentId: agent.agentId, agentName: agent.agent.name }))

  return { deps }
})
