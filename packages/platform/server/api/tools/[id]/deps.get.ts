export default defineEventHandler((event) => {
  const toolId = getRouterParam(event, 'id')
  if (!toolId || !/^[a-z0-9_-]+$/i.test(toolId)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  try {
    return { deps: toolManager.getGlobalDeps(toolId) }
  } catch (err) {
    throwAgentError(err)
  }
})
