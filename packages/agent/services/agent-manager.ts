import { AIMessageChunk } from '@langchain/core/messages'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { AgentError } from '../types'
import type { AgentInfo, AgentFileInfo, TemplateInfo } from '../types'
import agents from '../agents'
import { resolveBaseDir } from './resolve-base'
import { registerAgent, unregisterAgent } from './agent-registry'

type AgentChatStreamWriter = (chunk: unknown) => void
type AgentToolStreamEvent = {
  event: 'on_tool_start' | 'on_tool_event' | 'on_tool_end' | 'on_tool_error'
  toolCallId?: string
  name: string
  input?: unknown
  data?: unknown
  output?: unknown
  error?: unknown
}

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

function extractReasoningContent(message: unknown): string {
  if (!message || typeof message !== 'object') return ''

  const additionalKwargs = (message as { additional_kwargs?: { reasoning_content?: unknown } }).additional_kwargs
  if (typeof additionalKwargs?.reasoning_content === 'string' && additionalKwargs.reasoning_content) {
    return additionalKwargs.reasoning_content
  }

  const contentBlocks = (message as { contentBlocks?: Array<{ type?: string, reasoning?: unknown }> }).contentBlocks
  if (Array.isArray(contentBlocks)) {
    return contentBlocks
      .filter(block => block?.type === 'reasoning' && typeof block.reasoning === 'string')
      .map(block => block.reasoning as string)
      .join('')
  }

  return ''
}

function extractReplyFromState(state: unknown): string {
  if (!state || typeof state !== 'object') return ''

  const stateValues = 'values' in state && state.values && typeof state.values === 'object'
    ? state.values
    : state

  const messages = (stateValues as { messages?: Array<{ content?: unknown }> }).messages
  if (!Array.isArray(messages) || messages.length === 0) return ''

  const lastMessage = messages.at(-1)
  return lastMessage ? extractTextContent(lastMessage.content) : ''
}

const ALLOWED_FILES = ['agent.ts', 'memory.ts', 'model.ts', 'identity.ts', 'soul.md']

export function createAgentManager() {
  const baseDir = resolveBaseDir()
  const agentsDir = join(baseDir, 'agents')
  const templatesDir = join(baseDir, 'templates', 'agent')

  return {
    listAgents(): AgentInfo[] {
      const now = new Date().toISOString()
      return readdirSync(agentsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)
        .map((id) => {
          const data = agents[id]
          let name = id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
          if (data?.identity?.name) name = data.identity.name
          return {
            id,
            agentId: id,
            agent: {
              name,
              avatar: { src: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(id)}` },
            },
            messages: [],
            updatedAt: now,
          }
        })
    },

    createAgent(name: string, template: string): AgentInfo {
      const templateDir = join(templatesDir, template)
      if (!existsSync(templateDir)) {
        throw new AgentError('NOT_FOUND', 'Template not found')
      }

      let agentId = randomUUID()
      let newAgentDir = join(agentsDir, agentId)
      while (existsSync(newAgentDir)) {
        agentId = randomUUID()
        newAgentDir = join(agentsDir, agentId)
      }

      cpSync(templateDir, newAgentDir, { recursive: true })
      registerAgent(baseDir, agentId)

      const agentName = name.trim() || agentId
      return {
        id: agentId,
        agentId,
        agent: {
          name: agentName,
          avatar: { src: `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(agentId)}` },
        },
        messages: [],
        updatedAt: new Date().toISOString(),
      }
    },

    deleteAgent(id: string): void {
      const agentDir = join(agentsDir, id)
      if (!existsSync(agentDir)) {
        throw new AgentError('NOT_FOUND', `Agent "${id}" not found`)
      }

      rmSync(agentDir, { recursive: true, force: false })
      unregisterAgent(baseDir, id)
    },

    async invokeAgent(id: string, threadId: string, message: string): Promise<{ reply: string }> {
      const agentData = agents[id]
      if (!agentData) throw new AgentError('NOT_FOUND', `Agent "${id}" not found`)

      const agent = agentData.agent
      if (!agent?.invoke) throw new AgentError('NOT_FOUND', `Agent "${id}" is invalid or has no invoke method`)

      const config = { configurable: { thread_id: threadId } }
      const result = await agent.invoke(
        { messages: [{ role: 'user' as const, content: message }] },
        config,
      )

      const allMessages = result?.messages ?? []
      const lastMessage = allMessages.at(-1) as { content?: unknown } | undefined
      const reply = lastMessage ? extractTextContent(lastMessage.content) : ''
      return { reply: reply || '(No response from agent)' }
    },

    async streamAgent(
      id: string,
      threadId: string,
      message: string,
      writer: AgentChatStreamWriter,
    ): Promise<void> {
      const agentData = agents[id]
      if (!agentData) throw new AgentError('NOT_FOUND', `Agent "${id}" not found`)

      const agent = agentData.agent
      if (!agent?.stream) throw new AgentError('NOT_FOUND', `Agent "${id}" is invalid or has no stream method`)
      if (!agent?.getState) throw new AgentError('NOT_FOUND', `Agent "${id}" is invalid or has no getState method`)

      const config = {
        configurable: { thread_id: threadId }
      }

      const stream = await agent.stream(
        { messages: [{ role: 'user' as const, content: message }] },
        {
          ...config,
          streamMode: ['messages', 'tools', 'custom']
        },
      )

      let streamedReply = ''

      for await (const chunk of stream) {
        if (!Array.isArray(chunk) || chunk.length < 2) continue

        const [mode, payload] = chunk as [string, unknown]

        if (mode === 'messages' && Array.isArray(payload)) {
          const [messageChunk] = payload as [{ content?: unknown; type?: string }]
          if (!messageChunk) continue

          const isAiChunk = AIMessageChunk.isInstance(messageChunk) || messageChunk.type === 'ai'
          if (!isAiChunk) continue

          const reasoningDelta = extractReasoningContent(messageChunk)
          if (reasoningDelta) {
            writer({ type: 'thinking', delta: reasoningDelta })
          }

          const delta = extractTextContent(messageChunk.content)
          if (!delta) continue

          streamedReply += delta
          writer({ type: 'message', delta })
          continue
        }

        if (mode === 'tools') {
          writer({
            type: 'tool',
            event: payload as AgentToolStreamEvent
          })
          continue
        }

        if (mode === 'custom') {
          writer({
            type: 'progress',
            data: payload
          })
        }
      }

      const finalState = await agent.getState(config)
      const finalReply = extractReplyFromState(finalState)

      writer({
        type: 'result',
        reply: finalReply || streamedReply || '(No response from agent)'
      })
    },

    listAgentFiles(agentId: string): AgentFileInfo[] {
      const agentDir = join(agentsDir, agentId)
      return ALLOWED_FILES.map((file) => {
        const filePath = join(agentDir, file)
        let name = file
        if (name.endsWith('.ts')) name = name.slice(0, -3)
        if (name.endsWith('.md')) name = name.slice(0, -3)
        let content: string | undefined
        try {
          content = readFileSync(filePath, 'utf-8')
        } catch {
          if (file === 'soul.md') {
            content = 'Now you are agent for user, soon or leter you become someone'
          }
        }
        return { id: file, name, content, symlink: false }
      }).filter((f) => f.content !== undefined)
    },

    updateAgentFile(agentId: string, fileId: string, content: string): void {
      if (!ALLOWED_FILES.includes(fileId)) {
        throw new AgentError('INVALID_INPUT', 'Invalid file id')
      }
      const filePath = join(agentsDir, agentId, fileId)
      writeFileSync(filePath, content, 'utf-8')
    },

    listTemplates(): TemplateInfo[] {
      try {
        return readdirSync(templatesDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .map((d) => ({
            id: d.name,
            name: d.name.charAt(0).toUpperCase() + d.name.slice(1).replace(/[-_]/g, ' '),
          }))
      } catch {
        return []
      }
    },
  }
}

export type AgentManager = ReturnType<typeof createAgentManager>
