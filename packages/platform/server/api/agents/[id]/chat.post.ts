export default eventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9_-]+$/i.test(id)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }

  const body = await readBody<{ thread_id: string; message: string }>(event)
  const threadId = body?.thread_id
  const message = typeof body?.message === 'string' ? body.message.trim() : ''

  if (!threadId || typeof threadId !== 'string' || !threadId.trim()) {
    throw createError({ statusCode: 400, message: 'Request body must include thread_id.' })
  }
  if (!message) {
    throw createError({ statusCode: 400, message: 'Request body must include message (non-empty string).' })
  }

  try {
    return await agentManager.invokeAgent(id, threadId.trim(), message)
  } catch (err) {
    throwAgentError(err)
  }
})
