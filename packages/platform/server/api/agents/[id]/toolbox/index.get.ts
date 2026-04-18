import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: slugSchema }).parse)

  const linked = toolManager.listLinkedTools(id)
  const allTools = toolManager.listGlobal()

  return allTools.map((tool) => ({
    id: tool.id,
    name: tool.name,
    linked: linked.includes(tool.id),
  }))
})
