export default defineEventHandler((event) => {
  const agentId = getRouterParam(event, 'id')
  const toolId = getRouterParam(event, 'toolId')
  if (!agentId || !/^[a-z0-9_-]+$/i.test(agentId)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }
  if (!toolId || !/^[a-z0-9_-]+$/i.test(toolId)) {
    throw createError({ statusCode: 400, message: 'Invalid tool id' })
  }

  try {
    toolManager.deleteForAgent(agentId, toolId)
    return { ok: true }
  } catch (err) {
    throwAgentError(err)
  }
})
