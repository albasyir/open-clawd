import { AIMessageChunk } from '@langchain/core/messages'
import { Command } from '@langchain/langgraph'
import type { Decision, HITLRequest, HITLResponse } from 'langchain'
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { AgentError } from '../types'
import type { AgentInfo, AgentFileInfo, TemplateInfo } from '../types'
import agents from '../agents'
import { resolveBaseDir } from './resolve-base'
import { registerAgent, unregisterAgent } from './agent-registry'
import { isRecord, type UnknownRecord } from '../utils/record.ts'

type AgentChatStreamWriter = (chunk: unknown) => void
type AgentApprovalDecision = Decision | { type: 'comment', message: string }
type AgentChatResume = {
  decisions: AgentApprovalDecision[]
}
type AgentChatInput =
  | { message: string, resume?: never }
  | { message?: never, resume: AgentChatResume }
type CheckpointToolCall = {
  id?: string
  name: string
  args: Record<string, unknown>
}
type CheckpointPendingApproval = HITLRequest & {
  id?: string
  state: 'pending'
}
type AgentRuntime = {
  getState?: (config: unknown) => Promise<unknown>
  invoke?: (input: unknown, config?: unknown) => Promise<unknown>
  stream?: (input: unknown, config?: unknown) => Promise<AsyncIterable<unknown>>
}

const ALLOWED_FILES = ['agent.ts', 'memory.ts', 'model.ts', 'identity.ts', 'soul.md'] as const
type AgentFileId = typeof ALLOWED_FILES[number]

function isAllowedFile(fileId: string): fileId is AgentFileId {
  return ALLOWED_FILES.some(file => file === fileId)
}

function hasAgentMethod<K extends keyof AgentRuntime>(
  agent: unknown,
  method: K,
): agent is AgentRuntime & Required<Pick<AgentRuntime, K>> {
  return isRecord(agent) && typeof agent[method] === 'function'
}

function formatDisplayName(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1).replace(/[-_]/g, ' ')
}

function stripEditableExtension(fileName: string): string {
  return fileName.replace(/\.(?:ts|md)$/, '')
}

function getStateValues(state: unknown): UnknownRecord | undefined {
  if (!isRecord(state)) return undefined
  return isRecord(state.values) ? state.values : state
}

function isApprovalDecision(decision: unknown): decision is 'approve' | 'edit' | 'reject' {
  return decision === 'approve' || decision === 'edit' || decision === 'reject'
}

function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (typeof block === 'string') return block
        if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') return block.text
        return ''
      })
      .filter(Boolean)
      .join('')
    if (text) return text
  }
  if (content != null && typeof content === 'object') return JSON.stringify(content)
  return ''
}

function extractReasoningContent(message: unknown): string {
  if (!isRecord(message)) return ''

  const additionalKwargs = isRecord(message.additional_kwargs) ? message.additional_kwargs : undefined
  if (typeof additionalKwargs?.reasoning_content === 'string' && additionalKwargs.reasoning_content) {
    return additionalKwargs.reasoning_content
  }

  const contentBlocks = message.contentBlocks
  if (Array.isArray(contentBlocks)) {
    return contentBlocks
      .filter((block): block is UnknownRecord => isRecord(block))
      .flatMap(block => block.type === 'reasoning' && typeof block.reasoning === 'string' ? [block.reasoning] : [])
      .join('')
  }

  return ''
}

function extractReplyFromState(state: unknown): string {
  const stateValues = getStateValues(state)
  const messages = stateValues?.messages
  if (!Array.isArray(messages) || messages.length === 0) return ''

  const lastMessage = messages.at(-1)
  return isRecord(lastMessage) ? extractTextContent(lastMessage.content) : ''
}

function getMessageType(message: unknown): string {
  if (!isRecord(message)) return ''

  if (typeof message.type === 'string') return message.type

  try {
    const type = typeof message._getType === 'function'
      ? message._getType()
      : typeof message.getType === 'function'
        ? message.getType()
        : undefined
    return typeof type === 'string' ? type : ''
  } catch {
    return ''
  }
}

function getStateMessages(state: unknown): unknown[] {
  const messages = getStateValues(state)?.messages
  return Array.isArray(messages) ? messages : []
}

function getStateInterrupts(state: unknown): Array<{ id?: string, value?: unknown }> {
  if (!isRecord(state)) return []

  const tasks = state.tasks
  if (!Array.isArray(tasks)) return []

  return tasks.flatMap((task) => {
    const interrupts = isRecord(task) ? task.interrupts : undefined
    if (!Array.isArray(interrupts)) return []

    return interrupts.map((interrupt): { id?: string, value?: unknown } => {
      if (!isRecord(interrupt)) return { value: interrupt }

      return {
        id: typeof interrupt.id === 'string' ? interrupt.id : undefined,
        value: interrupt.value,
      }
    })
  })
}

function parseToolArgs(args: unknown): Record<string, unknown> {
  if (isRecord(args)) return args
  if (typeof args !== 'string') return {}

  try {
    const parsed = JSON.parse(args)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function extractToolCalls(message: unknown): CheckpointToolCall[] {
  if (!isRecord(message)) return []

  const additionalKwargs = isRecord(message.additional_kwargs) ? message.additional_kwargs : undefined
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls
    : Array.isArray(additionalKwargs?.tool_calls)
      ? additionalKwargs.tool_calls
      : []

  return toolCalls.map((toolCall): CheckpointToolCall | null => {
    if (!isRecord(toolCall)) return null

    const functionCall = isRecord(toolCall.function) ? toolCall.function : undefined
    const name = typeof toolCall.name === 'string'
      ? toolCall.name
      : typeof functionCall?.name === 'string'
        ? functionCall.name
        : ''
    if (!name) return null

    return {
      id: typeof toolCall.id === 'string' ? toolCall.id : undefined,
      name,
      args: parseToolArgs(toolCall.args ?? functionCall?.arguments),
    }
  }).filter((toolCall): toolCall is CheckpointToolCall => toolCall != null)
}

function normalizeCheckpointApproval(interrupt: { id?: string, value?: unknown }): CheckpointPendingApproval {
  const value = isRecord(interrupt.value) ? interrupt.value : {}
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
      const item = isRecord(action) ? action : {}
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
      const item = isRecord(config) ? config : {}
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
        allowedDecisions: allowedDecisions.filter(isApprovalDecision),
        argsSchema: isRecord(item.argsSchema)
          ? item.argsSchema
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
  const stateRecord = isRecord(state) ? state : undefined
  const date = typeof stateRecord?.createdAt === 'string'
    ? stateRecord.createdAt
    : new Date().toISOString()
  const chatMessages: unknown[] = []
  const pendingToolCalls = new Map<string, CheckpointToolCall>()
  let generatedToolCallIndex = 0

  messages.forEach((message, index) => {
    const type = getMessageType(message)
    const item = isRecord(message) ? message : {}
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

function extractInterrupt(payload: unknown): { id?: string, value?: unknown } | null {
  if (!isRecord(payload)) return null

  const interrupts = payload.__interrupt__
  if (!Array.isArray(interrupts) || interrupts.length === 0) return null

  const firstInterrupt = interrupts[0]
  if (!isRecord(firstInterrupt)) return { value: firstInterrupt }

  return {
    id: typeof firstInterrupt.id === 'string' ? firstInterrupt.id : undefined,
    value: firstInterrupt.value,
  }
}

function normalizeApprovalResume(resume: AgentChatResume): HITLResponse {
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
          let name = formatDisplayName(id)
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
        if (!hasAgentMethod(agent, 'getState')) return agentInfo

        try {
          const state = await agent.getState({ configurable: { thread_id: agentInfo.id } })
          const messages = mapCheckpointStateToChatMessages(agentInfo.id, state)
          const stateRecord = isRecord(state) ? state : undefined
          return {
            ...agentInfo,
            messages,
            updatedAt: typeof stateRecord?.createdAt === 'string'
              ? stateRecord.createdAt
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
      if (!hasAgentMethod(agent, 'invoke')) {
        throw new AgentError('NOT_FOUND', `Agent "${id}" is invalid or has no invoke method`)
      }

      const config = { configurable: { thread_id: threadId } }
      const result = await agent.invoke(
        { messages: [{ role: 'user' as const, content: message }] },
        config,
      )

      const allMessages = isRecord(result) && Array.isArray(result.messages) ? result.messages : []
      const lastMessage = allMessages.at(-1)
      const reply = isRecord(lastMessage) ? extractTextContent(lastMessage.content) : ''
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
      if (!hasAgentMethod(agent, 'stream')) {
        throw new AgentError('NOT_FOUND', `Agent "${id}" is invalid or has no stream method`)
      }
      if (!hasAgentMethod(agent, 'getState')) {
        throw new AgentError('NOT_FOUND', `Agent "${id}" is invalid or has no getState method`)
      }

      const config = {
        configurable: { thread_id: threadId }
      }

      const agentInput = input.resume
        ? new Command({ resume: normalizeApprovalResume(input.resume) })
        : { messages: [{ role: 'user' as const, content: input.message }] }

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

        const [mode, payload] = chunk
        if (typeof mode !== 'string') continue

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
          const [messageChunk] = payload
          if (!isRecord(messageChunk)) continue

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
            event: payload
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
        const name = stripEditableExtension(file)
        let content: string | undefined
        try {
          content = readFileSync(filePath, 'utf-8')
        } catch {
          if (file === 'soul.md') {
            content = 'Now you are agent for user, soon or later you become someone'
          }
        }
        return { id: file, name, content, symlink: false }
      }).filter((f) => f.content !== undefined)
    },

    updateAgentFile(agentId: string, fileId: string, content: string): void {
      if (!isAllowedFile(fileId)) {
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
            name: formatDisplayName(d.name),
          }))
      } catch {
        return []
      }
    },
  }
}

export type AgentManager = ReturnType<typeof createAgentManager>
