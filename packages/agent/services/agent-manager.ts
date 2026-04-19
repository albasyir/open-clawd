import { AIMessageChunk } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { AgentError } from '../types'
import type { AgentInfo, AgentFileInfo, TemplateInfo } from '../types'
import agents from '../agents'
import { resolveBaseDir } from './resolve-base'
import { registerAgent, unregisterAgent } from './agent-registry'

type AgentChatStreamWriter = (chunk: unknown) => void
type AgentApprovalDecision =
  | { type: 'approve' }
  | { type: 'edit', editedAction: { name: string, args: Record<string, unknown> } }
  | { type: 'reject', message?: string }
  | { type: 'comment', message: string }
type AgentChatResume = {
  decisions: AgentApprovalDecision[]
}
type AgentChatInput =
  | { message: string, resume?: never }
  | { message?: never, resume: AgentChatResume }
type AgentToolStreamEvent = {
  event: 'on_tool_start' | 'on_tool_event' | 'on_tool_end' | 'on_tool_error'
  toolCallId?: string
  name: string
  input?: unknown
  data?: unknown
  output?: unknown
  error?: unknown
}
type CheckpointToolCall = {
  id?: string
  name: string
  args: Record<string, unknown>
}
type CheckpointPendingApproval = {
  id?: string
  actionRequests: Array<{ name: string, args: Record<string, unknown>, description?: string }>
  reviewConfigs: Array<{ actionName: string, allowedDecisions: Array<'approve' | 'edit' | 'reject'>, argsSchema?: Record<string, unknown> }>
  state: 'pending'
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

function getMessageType(message: unknown): string {
  if (!message || typeof message !== 'object') return ''

  const item = message as { type?: unknown, _getType?: () => unknown, getType?: () => unknown }
  if (typeof item.type === 'string') return item.type

  try {
    const type = item._getType?.() ?? item.getType?.()
    return typeof type === 'string' ? type : ''
  } catch {
    return ''
  }
}

function getStateMessages(state: unknown): unknown[] {
  if (!state || typeof state !== 'object') return []

  const values = 'values' in state && state.values && typeof state.values === 'object'
    ? state.values
    : state
  const messages = (values as { messages?: unknown }).messages
  return Array.isArray(messages) ? messages : []
}

function getStateInterrupts(state: unknown): Array<{ id?: string, value?: unknown }> {
  if (!state || typeof state !== 'object') return []

  const tasks = (state as { tasks?: unknown }).tasks
  if (!Array.isArray(tasks)) return []

  return tasks.flatMap((task) => {
    const interrupts = task && typeof task === 'object'
      ? (task as { interrupts?: unknown }).interrupts
      : undefined
    if (!Array.isArray(interrupts)) return []

    return interrupts.map((interrupt) => {
      if (!interrupt || typeof interrupt !== 'object') return { value: interrupt }

      return {
        id: typeof (interrupt as { id?: unknown }).id === 'string'
          ? (interrupt as { id: string }).id
          : undefined,
        value: (interrupt as { value?: unknown }).value,
      }
    })
  })
}

function parseToolArgs(args: unknown): Record<string, unknown> {
  if (args && typeof args === 'object' && !Array.isArray(args)) return args as Record<string, unknown>
  if (typeof args !== 'string') return {}

  try {
    const parsed = JSON.parse(args)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function extractToolCalls(message: unknown): CheckpointToolCall[] {
  if (!message || typeof message !== 'object') return []

  const item = message as {
    tool_calls?: unknown
    additional_kwargs?: { tool_calls?: unknown }
  }
  const toolCalls = Array.isArray(item.tool_calls)
    ? item.tool_calls
    : Array.isArray(item.additional_kwargs?.tool_calls)
      ? item.additional_kwargs.tool_calls
      : []

  return toolCalls.map((toolCall): CheckpointToolCall | null => {
    if (!toolCall || typeof toolCall !== 'object') return null

    const call = toolCall as {
      id?: unknown
      name?: unknown
      args?: unknown
      function?: { name?: unknown, arguments?: unknown }
    }
    const name = typeof call.name === 'string'
      ? call.name
      : typeof call.function?.name === 'string'
        ? call.function.name
        : ''
    if (!name) return null

    return {
      id: typeof call.id === 'string' ? call.id : undefined,
      name,
      args: parseToolArgs(call.args ?? call.function?.arguments),
    }
  }).filter((toolCall): toolCall is CheckpointToolCall => toolCall != null)
}

function normalizeCheckpointApproval(interrupt: { id?: string, value?: unknown }): CheckpointPendingApproval {
  const value = interrupt.value && typeof interrupt.value === 'object'
    ? interrupt.value as Record<string, unknown>
    : {}
  const actionRequests = Array.isArray(value.actionRequests)
    ? value.actionRequests
    : Array.isArray(value.action_requests)
      ? value.action_requests
      : []
  const reviewConfigs = Array.isArray(value.reviewConfigs)
    ? value.reviewConfigs
    : Array.isArray(value.review_configs)
      ? value.review_configs
      : []

  return {
    id: interrupt.id,
    actionRequests: actionRequests.map((action) => {
      const item = action && typeof action === 'object' ? action as Record<string, unknown> : {}
      const name = typeof item.name === 'string'
        ? item.name
        : typeof item.action === 'string'
          ? item.action
          : 'tool'

      return {
        name,
        args: parseToolArgs(item.args),
        description: typeof item.description === 'string' ? item.description : undefined,
      }
    }),
    reviewConfigs: reviewConfigs.map((config) => {
      const item = config && typeof config === 'object' ? config as Record<string, unknown> : {}
      const allowedDecisions = Array.isArray(item.allowedDecisions)
        ? item.allowedDecisions
        : Array.isArray(item.allowed_decisions)
          ? item.allowed_decisions
          : ['approve', 'reject']

      return {
        actionName: typeof item.actionName === 'string'
          ? item.actionName
          : typeof item.action_name === 'string'
            ? item.action_name
            : 'tool',
        allowedDecisions: allowedDecisions.filter((decision): decision is 'approve' | 'edit' | 'reject' =>
          decision === 'approve' || decision === 'edit' || decision === 'reject'
        ),
        argsSchema: item.argsSchema && typeof item.argsSchema === 'object'
          ? item.argsSchema as Record<string, unknown>
          : undefined,
      }
    }),
    state: 'pending',
  }
}

function createChatMessageId(agentId: string, index: number, suffix: string): string {
  return `${agentId}-checkpoint-${index}-${suffix}`
}

function mapCheckpointStateToChatMessages(agentId: string, state: unknown): unknown[] {
  const messages = getStateMessages(state)
  const date = typeof (state as { createdAt?: unknown } | null)?.createdAt === 'string'
    ? (state as { createdAt: string }).createdAt
    : new Date().toISOString()
  const chatMessages: unknown[] = []
  const pendingToolCalls = new Map<string, CheckpointToolCall>()
  let generatedToolCallIndex = 0

  messages.forEach((message, index) => {
    const type = getMessageType(message)
    const item = message && typeof message === 'object'
      ? message as { id?: unknown, content?: unknown, name?: unknown, tool_call_id?: unknown, status?: unknown }
      : {}
    const content = extractTextContent(item.content)

    if (type === 'human') {
      chatMessages.push({
        id: typeof item.id === 'string' ? item.id : createChatMessageId(agentId, index, 'user'),
        role: 'user',
        content,
        date,
      })
      return
    }

    if (type === 'ai') {
      for (const toolCall of extractToolCalls(message)) {
        const id = toolCall.id ?? `checkpoint-tool-${generatedToolCallIndex++}`
        pendingToolCalls.set(id, { ...toolCall, id })
      }

      if (content.trim()) {
        chatMessages.push({
          id: typeof item.id === 'string' ? item.id : createChatMessageId(agentId, index, 'agent'),
          role: 'agent',
          content,
          date,
          streamState: 'done',
        })
      }
      return
    }

    if (type === 'tool') {
      const toolCallId = typeof item.tool_call_id === 'string' ? item.tool_call_id : undefined
      const toolCall = toolCallId ? pendingToolCalls.get(toolCallId) : undefined
      const toolName = toolCall?.name ?? (typeof item.name === 'string' ? item.name : 'tool')
      const failed = item.status === 'error'

      if (toolCallId) pendingToolCalls.delete(toolCallId)
      chatMessages.push({
        id: typeof item.id === 'string' ? item.id : createChatMessageId(agentId, index, 'tool'),
        role: 'agent',
        content: '',
        date,
        timeline: [
          {
            value: toolCallId ?? createChatMessageId(agentId, index, 'tool-call'),
            slot: `tool-${index}`,
            date,
            title: toolName,
            description: `${failed ? '[error]' : '[done]'}\n${content}`,
            icon: failed ? 'i-lucide-circle-alert' : 'i-lucide-circle-check',
            toolState: failed ? 'error' : 'done',
          },
        ],
        streamState: failed ? 'error' : 'done',
      })
    }
  })

  for (const interrupt of getStateInterrupts(state)) {
    const pendingApproval = normalizeCheckpointApproval(interrupt)
    const firstAction = pendingApproval.actionRequests[0]

    if (firstAction) {
      chatMessages.push({
        id: createChatMessageId(agentId, chatMessages.length, 'interrupted-tool'),
        role: 'agent',
        content: '',
        date,
        timeline: [
          {
            value: firstAction.name,
            slot: `tool-${chatMessages.length}`,
            date,
            title: firstAction.name,
            description: '[interrupted]\nTool execution paused for approval',
            icon: 'i-lucide-circle-pause',
            toolState: 'interrupted',
            durationMs: 0,
          },
        ],
        streamState: 'done',
      })
    }

    chatMessages.push({
      id: createChatMessageId(agentId, chatMessages.length, 'approval'),
      role: 'agent',
      content: '',
      date,
      pendingApproval,
      streamState: 'done',
    })
  }

  return chatMessages
}

function extractInterrupt(payload: unknown): unknown | null {
  if (!payload || typeof payload !== 'object') return null

  const interrupts = (payload as { __interrupt__?: unknown }).__interrupt__
  if (!Array.isArray(interrupts) || interrupts.length === 0) return null

  const firstInterrupt = interrupts[0]
  if (!firstInterrupt || typeof firstInterrupt !== 'object') return firstInterrupt ?? null

  return {
    id: (firstInterrupt as { id?: unknown }).id,
    value: (firstInterrupt as { value?: unknown }).value,
  }
}

function normalizeApprovalResume(resume: AgentChatResume): AgentChatResume {
  return {
    decisions: resume.decisions.map((decision) => {
      if (decision.type !== 'comment') return decision

      return {
        type: 'reject',
        message: [
          'Human approval comment for the blocked shell_exec call:',
          decision.message.trim(),
          '',
          'Evaluate this feedback before continuing. If a shell command is still needed, call shell_exec again with revised arguments so it can be approved. Do not execute the previously requested shell command.',
        ].join('\n'),
      }
    }),
  }
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

    async listAgentChats(): Promise<AgentInfo[]> {
      const agentInfos = this.listAgents()

      return await Promise.all(agentInfos.map(async (agentInfo) => {
        const agentData = agents[agentInfo.agentId]
        const agent = agentData?.agent
        if (!agent?.getState) return agentInfo

        try {
          const state = await agent.getState({ configurable: { thread_id: agentInfo.id } })
          const messages = mapCheckpointStateToChatMessages(agentInfo.id, state)
          return {
            ...agentInfo,
            messages,
            updatedAt: typeof (state as { createdAt?: unknown }).createdAt === 'string'
              ? (state as { createdAt: string }).createdAt
              : agentInfo.updatedAt,
          }
        } catch {
          return agentInfo
        }
      }))
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
      input: AgentChatInput,
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

      const agentInput = input.resume
        ? new Command({ resume: normalizeApprovalResume(input.resume) })
        : { messages: [{ role: 'user' as const, content: input.message! }] }

      const stream = await agent.stream(
        agentInput,
        {
          ...config,
          streamMode: ['messages', 'tools', 'custom', 'updates']
        },
      )

      let streamedReply = ''
      let interrupted = false

      for await (const chunk of stream) {
        if (!Array.isArray(chunk) || chunk.length < 2) continue

        const [mode, payload] = chunk as [string, unknown]

        if (mode === 'updates') {
          const interrupt = extractInterrupt(payload)
          if (interrupt) {
            interrupted = true
            writer({
              type: 'interrupt',
              data: interrupt
            })
          }
          continue
        }

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

      if (interrupted) return

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
