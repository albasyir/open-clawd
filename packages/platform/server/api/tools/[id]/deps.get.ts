import { z } from 'zod'

export default defineEventHandler(async (event) => {
  const { id } = await getValidatedRouterParams(event, z.object({ id: slugSchema }).parse)

  try {
    return { deps: toolManager.getGlobalDeps(id) }
  } catch (err) {
    throwAgentError(err)
  }
})
