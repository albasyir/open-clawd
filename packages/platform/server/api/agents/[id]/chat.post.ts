import { agents } from 'clawpro-agent'

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .map((block: any) => (block?.type === 'text' ? block.text : typeof block === 'string' ? block : ''))
      .filter(Boolean)
      .join('')
    if (text) return text
  }
  if (content != null && typeof content === 'object') return JSON.stringify(content)
  return ''
}

export default eventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id || !/^[a-z0-9_-]+$/i.test(id)) {
    throw createError({ statusCode: 400, message: 'Invalid agent id' })
  }

  const agentData = agents[id]
  if (!agentData) {
    throw createError({ statusCode: 404, message: `Agent "${id}" not found` })
  }

  const agent = agentData.agent

  if (!agent?.invoke) {
    throw createError({ statusCode: 404, message: `Agent "${id}" is invalid or has no invoke method` })
  }

  const body = await readBody<{ thread_id: string; message: string }>(event)
  const threadId = body?.thread_id
  const message = typeof body?.message === 'string' ? body.message.trim() : ''

  if (!threadId || typeof threadId !== 'string' || !threadId.trim()) {
    throw createError({
      statusCode: 400,
      message: 'Request body must include thread_id.'
    })
  }

  if (!message) {
    throw createError({
      statusCode: 400,
      message: 'Request body must include message (non-empty string).'
    })
  }

  try {
    const config = { configurable: { thread_id: threadId.trim() } }
    const result = await agent.invoke(
      { messages: [{ role: 'user' as const, content: message }] },
      config
    )

    const allMessages = result?.messages ?? []
    const lastMessage = allMessages.at(-1) as { content?: unknown } | undefined
    const reply = lastMessage ? extractTextContent(lastMessage.content) : ''

    return { reply: reply || '(No response from agent)' }
  } catch (err: any) {
    const message = err?.message ?? String(err)
    const statusCode = err?.statusCode ?? 500
    throw createError({
      statusCode: Number.isFinite(statusCode) ? statusCode : 500,
      message: message || `Agent "${id}" invocation failed`
    })
  }
})
