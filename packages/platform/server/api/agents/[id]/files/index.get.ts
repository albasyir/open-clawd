import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: slugSchema }).parse)
  return agentManager.listAgentFiles(id)
})
