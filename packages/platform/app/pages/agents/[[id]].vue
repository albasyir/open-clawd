<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { AgentConversation, ChatApprovalAction, ChatApprovalReviewConfig, ChatMessage, ChatPendingApproval, ChatTimelineItem } from '~/types'

type ChatToolStreamEvent = {
  event: 'on_tool_start' | 'on_tool_event' | 'on_tool_end' | 'on_tool_error'
  toolCallId?: string
  name: string
  input?: unknown
  data?: unknown
  output?: unknown
  error?: unknown
}

type ChatStreamChunk
  = { type: 'message', delta: string }
    | { type: 'thinking', delta: string }
    | { type: 'tool', event: ChatToolStreamEvent }
    | { type: 'progress', data: unknown }
    | { type: 'interrupt', data: { id?: string, value?: unknown } }
    | { type: 'result', reply: string }
    | { type: 'error', message: string }

type ChatApprovalDecision =
  | { type: 'approve' }
  | { type: 'edit', editedAction: ChatApprovalEditedAction }
  | { type: 'comment', message: string }
  | { type: 'reject', message?: string }

type ChatApprovalEditedAction = {
  name: string
  args: Record<string, unknown>
}

type AgentChatRequestBody =
  | { thread_id: string, message: string, stream: true }
  | { thread_id: string, resume: { decisions: ChatApprovalDecision[] }, stream: true }

type AgentStreamConversation = {
  id: string
  agentId: string
  agent: {
    name: string
  }
}

const route = useRoute()
const router = useRouter()

const { data: chatsData, refresh: refreshChats } = await useFetch<AgentConversation[]>('/api/agents/chats', { default: () => [] })

function findConversationById(conversations: AgentConversation[], id: string) {
  return conversations.find(conversation => conversation.id === id) ?? null
}

function getRouteConversationId() {
  if (typeof route.params.id === 'string' && route.params.id) return route.params.id
  if (typeof route.query.id === 'string' && route.query.id) return route.query.id
  return null
}

/** Threads: one per agent from API, plus new threads from "New chat". Keyed by thread id so each chat has its own messages. */
const threads = ref<AgentConversation[]>([])
watch(chatsData, (data) => {
  threads.value = data ? [...data] : []
}, { immediate: true })

const selectedConversationId = ref<string | null>(null)
watch(
  () => [route.params.id, route.query.id, threads.value] as const,
  () => {
    const routeConversationId = getRouteConversationId()
    selectedConversationId.value = routeConversationId
      ? findConversationById(threads.value, routeConversationId)?.id ?? null
      : null
  },
  { immediate: true }
)

watch(selectedConversationId, (conversationId) => {
  const routeConversationId = getRouteConversationId()

  if (conversationId) {
    if (routeConversationId !== conversationId || route.query.id) {
      void router.replace({ path: `/agents/${conversationId}` })
    }
  } else if (routeConversationId) {
    void router.replace({ path: '/agents' })
  }
}, { flush: 'post' })

const selectedConversation = ref<AgentConversation | null>(null)
watch([threads, selectedConversationId], ([conversations, selectedId]) => {
  selectedConversation.value = selectedId
    ? findConversationById(conversations, selectedId)
    : null
}, { immediate: true })

/** Live messages per thread id (each chat has its own history). */
const agentMessagesMap = ref<Record<string, ChatMessage[]>>({})

/** Conversation to pass to chat: use live messages from map, else list data. */
const displayConversation = ref<AgentConversation | null>(null)
watch([selectedConversation, agentMessagesMap], ([conversation, messagesMap]) => {
  if (!conversation) {
    displayConversation.value = null
    return
  }

  displayConversation.value = {
    ...conversation,
    messages: messagesMap[conversation.id] ?? conversation.messages
  }
}, { immediate: true, deep: true })

const isChatPanelOpen = computed({
  get: () => !!selectedConversationId.value,
  set: (value: boolean) => {
    if (!value) selectedConversationId.value = null
  }
})

watch(threads, () => {
  if (selectedConversationId.value && !findConversationById(threads.value, selectedConversationId.value)) {
    selectedConversationId.value = null
  }
})

const toast = useToast()
const sendLoading = ref(false)
const shellRejectedMessage = 'Shell command rejected by user. Do not call shell_exec again for this request.'

function updateConversationMessages(conversationId: string, updater: (messages: ChatMessage[]) => ChatMessage[]) {
  const currentMessages = agentMessagesMap.value[conversationId] ?? selectedConversation.value?.messages ?? []
  agentMessagesMap.value = {
    ...agentMessagesMap.value,
    [conversationId]: updater(currentMessages)
  }
}

function formatStreamData(data: unknown): string {
  if (typeof data === 'string') {
    return data
  }

  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function appendTimelineDetail(current: string, label: string, data?: unknown): string {
  const details = data == null ? label : `${label}\n${formatStreamData(data)}`
  return current ? `${current}\n\n${details}` : details
}

function isInterruptToolError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false

  const item = error as Record<string, unknown>
  return item.name === 'GraphInterrupt'
    || Array.isArray(item.interrupts)
    || Array.isArray(item.__interrupt__)
}

function normalizePendingApproval(interrupt: { id?: string, value?: unknown }): ChatPendingApproval {
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
    actionRequests: actionRequests.map((action): ChatApprovalAction => {
      const item = action && typeof action === 'object' ? action as Record<string, unknown> : {}
      const name = typeof item.name === 'string'
        ? item.name
        : typeof item.action === 'string'
          ? item.action
          : 'tool'

      return {
        name,
        args: item.args && typeof item.args === 'object' ? item.args as Record<string, unknown> : {},
        description: typeof item.description === 'string' ? item.description : undefined
      }
    }),
    reviewConfigs: reviewConfigs.map((config): ChatApprovalReviewConfig => {
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
        allowedDecisions: allowedDecisions.filter(decision =>
          decision === 'approve' || decision === 'edit' || decision === 'reject'
        ),
        argsSchema: item.argsSchema && typeof item.argsSchema === 'object'
          ? item.argsSchema as Record<string, unknown>
          : undefined
      }
    }),
    state: 'pending'
  }
}

async function runAgentStream(conversation: AgentStreamConversation, body: AgentChatRequestBody) {
  const conversationId = conversation.id
  const agentName = conversation.agent.name

  sendLoading.value = true
  const initialAgentMessageId = `${conversationId}-a-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  updateConversationMessages(conversationId, messages => [
    ...messages,
    {
      id: initialAgentMessageId,
      role: 'agent',
      content: '',
      date: new Date().toISOString(),
      streamState: 'working'
    }
  ])

  let currentTextMessageId: string | null = initialAgentMessageId
  let currentTextContent = ''
  let currentTextThinking = ''
  let currentThinkingState: ChatMessage['thinkingState']
  let currentThinkingStartedAt: number | null = null
  let currentThinkingDurationMs: number | undefined
  let currentToolMessageId: string | null = null
  let currentToolTimeline: ChatTimelineItem[] = []
  let currentToolTimelineIndexByKey = new Map<string, number>()
  let activeToolKeys: string[] = []
  let streamFailed = false

  function appendAgentMessage(message: ChatMessage): string {
    updateConversationMessages(conversationId, messages => [...messages, message])
    return message.id
  }

  function updateAgentMessage(
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) {
    updateConversationMessages(conversationId, messages =>
      messages.map(msg => msg.id === messageId ? updater(msg) : msg)
    )
  }

  function removeAgentMessage(messageId: string) {
    updateConversationMessages(conversationId, messages =>
      messages.filter(msg => msg.id !== messageId)
    )
  }

  function syncCurrentToolMessage(streamState: ChatMessage['streamState']) {
    if (!currentToolMessageId) return

    updateAgentMessage(currentToolMessageId, message => ({
      ...message,
      timeline: [...currentToolTimeline],
      streamState
    }))
  }

  function completeThinking() {
    if (!currentTextMessageId || !currentTextThinking || currentThinkingState === 'done') return

    const durationMs = Math.max(0, Date.now() - (currentThinkingStartedAt ?? Date.now()))
    currentThinkingState = 'done'
    currentThinkingDurationMs = durationMs

    updateAgentMessage(currentTextMessageId, message => ({
      ...message,
      thinking: currentTextThinking,
      thinkingState: 'done',
      thinkingDurationMs: durationMs
    }))
  }

  try {
    const response = await fetch(`/api/agents/${conversation.agentId}/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/x-ndjson'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok || !response.body) {
      throw new Error(await response.text() || 'Failed to start response stream')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    function createAgentTextMessage(initialContent = '', streamState: ChatMessage['streamState'] = 'working'): string {
      const id = `${conversationId}-a-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      currentTextMessageId = appendAgentMessage({
        id,
        role: 'agent',
        content: initialContent,
        thinking: '',
        thinkingState: undefined,
        thinkingDurationMs: undefined,
        date: new Date().toISOString(),
        streamState
      })
      currentTextContent = initialContent
      currentTextThinking = ''
      currentThinkingState = undefined
      currentThinkingStartedAt = null
      currentThinkingDurationMs = undefined
      return currentTextMessageId
    }

    function createAgentToolMessage(streamState: ChatMessage['streamState'] = 'working'): string {
      const id = `${conversationId}-a-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      currentToolMessageId = appendAgentMessage({
        id,
        role: 'agent',
        content: '',
        date: new Date().toISOString(),
        timeline: [],
        streamState
      })
      currentToolTimeline = []
      currentToolTimelineIndexByKey = new Map()
      activeToolKeys = []
      return currentToolMessageId
    }

    function resetTextSegment() {
      currentTextMessageId = null
      currentTextContent = ''
      currentTextThinking = ''
      currentThinkingState = undefined
      currentThinkingStartedAt = null
      currentThinkingDurationMs = undefined
    }

    function resetToolSegment() {
      currentToolMessageId = null
      currentToolTimeline = []
      currentToolTimelineIndexByKey = new Map()
      activeToolKeys = []
    }

    function finishToolSegment(streamState: ChatMessage['streamState']) {
      syncCurrentToolMessage(streamState)
      resetToolSegment()
    }

    function finishInterruptedToolSegment() {
      if (!currentToolMessageId || !currentToolTimeline.length) return false

      const activeKeys = new Set(activeToolKeys)
      currentToolTimeline = currentToolTimeline.map(item => {
        if (item.toolState !== 'working' && !activeKeys.has(item.value)) return item

        return {
          ...item,
          description: appendTimelineDetail(item.description, '[interrupted]', 'Tool execution paused for approval'),
          icon: 'i-lucide-circle-pause',
          toolState: 'interrupted',
          durationMs: item.durationMs ?? Math.max(0, Date.now() - new Date(item.date).getTime())
        }
      })
      activeToolKeys = []
      finishToolSegment('done')
      return true
    }

    function enterTextSegment(streamState: ChatMessage['streamState'] = 'working'): string {
      if (currentToolMessageId) {
        finishToolSegment('done')
      }

      if (!currentTextMessageId) {
        return createAgentTextMessage('', streamState)
      }

      return currentTextMessageId
    }

    function enterToolSegment(streamState: ChatMessage['streamState'] = 'working'): string {
      if (currentTextMessageId) {
        if (!currentTextContent && !currentTextThinking) {
          currentToolMessageId = currentTextMessageId
          currentTextMessageId = null
          currentToolTimeline = []
          currentToolTimelineIndexByKey = new Map()
          activeToolKeys = []
          return currentToolMessageId
        }

        resetTextSegment()
      }

      if (!currentToolMessageId) {
        return createAgentToolMessage(streamState)
      }

      return currentToolMessageId
    }

    function upsertTimelineItem(key: string, build: (existing: ChatTimelineItem | undefined) => ChatTimelineItem) {
      const index = currentToolTimelineIndexByKey.get(key)
      if (index == null) {
        const item = build(undefined)
        currentToolTimelineIndexByKey.set(key, currentToolTimeline.length)
        currentToolTimeline.push(item)
        return item
      }

      const item = build(currentToolTimeline[index])
      currentToolTimeline[index] = item
      return item
    }

    function getActiveToolKey() {
      return activeToolKeys.at(-1) ?? null
    }

    function showPendingApproval(interrupt: { id?: string, value?: unknown }) {
      completeThinking()
      if (currentToolMessageId && !finishInterruptedToolSegment()) {
        finishToolSegment('done')
      }

      const pendingApproval = normalizePendingApproval(interrupt)
      const approvalMessage: ChatMessage = {
        id: `${conversationId}-a-approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        role: 'agent',
        content: '',
        date: new Date().toISOString(),
        pendingApproval,
        streamState: 'done'
      }

      if (currentTextMessageId && !currentTextContent && !currentTextThinking) {
        updateAgentMessage(currentTextMessageId, message => ({
          ...message,
          pendingApproval,
          streamState: 'done'
        }))
        resetTextSegment()
      } else {
        appendAgentMessage(approvalMessage)
      }
    }

    const handleStreamChunk = (chunk: ChatStreamChunk) => {
      if (chunk.type === 'thinking') {
        const messageId = enterTextSegment('working')
        if (!currentThinkingStartedAt) currentThinkingStartedAt = Date.now()
        currentTextThinking += chunk.delta
        currentThinkingState = 'working'
        updateAgentMessage(messageId, message => ({
          ...message,
          thinking: currentTextThinking,
          thinkingState: 'working',
          thinkingDurationMs: undefined,
          streamState: 'working'
        }))
        return
      }

      if (chunk.type === 'message') {
        completeThinking()
        const messageId = enterTextSegment('working')
        currentTextContent += chunk.delta
        updateAgentMessage(messageId, message => ({
          ...message,
          content: currentTextContent,
          thinking: currentTextThinking,
          thinkingState: currentThinkingState,
          thinkingDurationMs: currentThinkingDurationMs,
          streamState: 'working'
        }))
        return
      }

      if (chunk.type === 'tool') {
        completeThinking()
        enterToolSegment('working')
        const event = chunk.event
        const key = event.toolCallId ?? `${event.name}-${currentToolTimeline.length}`

        if (event.event === 'on_tool_start') {
          upsertTimelineItem(key, (existing) => ({
            value: key,
            slot: existing?.slot ?? `tool-${currentToolTimeline.length}`,
            date: existing?.date ?? new Date().toISOString(),
            title: event.name,
            description: appendTimelineDetail(existing?.description ?? '', '[start]', event.input),
            icon: 'i-lucide-loader-circle',
            toolState: 'working',
            durationMs: undefined
          }))
          activeToolKeys.push(key)
          syncCurrentToolMessage('working')
          return
        }

        if (event.event === 'on_tool_event') {
          const activeKey = currentToolTimelineIndexByKey.has(key) ? key : getActiveToolKey()
          if (!activeKey) return

          upsertTimelineItem(activeKey, (existing) => ({
            value: existing?.value ?? activeKey,
            slot: existing?.slot ?? `tool-${currentToolTimeline.length}`,
            date: existing?.date ?? new Date().toISOString(),
            title: existing?.title ?? event.name,
            description: appendTimelineDetail(existing?.description ?? '', '[progress]', event.data),
            icon: 'i-lucide-loader-circle',
            toolState: existing?.toolState ?? 'working',
            durationMs: existing?.durationMs
          }))
          syncCurrentToolMessage('working')
          return
        }

        if (event.event === 'on_tool_end') {
          const activeKey = currentToolTimelineIndexByKey.has(key) ? key : getActiveToolKey()
          if (!activeKey) return

          upsertTimelineItem(activeKey, (existing) => ({
            value: existing?.value ?? activeKey,
            slot: existing?.slot ?? `tool-${currentToolTimeline.length}`,
            date: existing?.date ?? new Date().toISOString(),
            title: existing?.title ?? event.name,
            description: appendTimelineDetail(existing?.description ?? '', '[done]', event.output),
            icon: 'i-lucide-circle-check',
            toolState: 'done',
            durationMs: existing ? Math.max(0, Date.now() - new Date(existing.date).getTime()) : undefined
          }))

          const activeIndex = activeToolKeys.lastIndexOf(activeKey)
          if (activeIndex >= 0) activeToolKeys.splice(activeIndex, 1)
          syncCurrentToolMessage(activeToolKeys.length > 0 ? 'working' : 'done')
          return
        }

        if (event.event === 'on_tool_error' && isInterruptToolError(event.error)) {
          const activeKey = currentToolTimelineIndexByKey.has(key) ? key : getActiveToolKey()
          if (!activeKey) return

          upsertTimelineItem(activeKey, existing => ({
            value: existing?.value ?? activeKey,
            slot: existing?.slot ?? `tool-${currentToolTimeline.length}`,
            date: existing?.date ?? new Date().toISOString(),
            title: existing?.title ?? event.name,
            description: appendTimelineDetail(existing?.description ?? '', '[interrupted]', 'Tool execution paused for approval'),
            icon: 'i-lucide-circle-pause',
            toolState: 'interrupted',
            durationMs: existing ? Math.max(0, Date.now() - new Date(existing.date).getTime()) : undefined
          }))

          const activeIndex = activeToolKeys.lastIndexOf(activeKey)
          if (activeIndex >= 0) activeToolKeys.splice(activeIndex, 1)
          syncCurrentToolMessage('done')
          return
        }

        const activeKey = currentToolTimelineIndexByKey.has(key) ? key : getActiveToolKey() ?? key
        upsertTimelineItem(activeKey, (existing) => ({
          value: existing?.value ?? activeKey,
          slot: existing?.slot ?? `tool-${currentToolTimeline.length}`,
          date: existing?.date ?? new Date().toISOString(),
          title: existing?.title ?? event.name,
          description: appendTimelineDetail(existing?.description ?? '', '[error]', event.error),
          icon: 'i-lucide-circle-alert',
          toolState: 'error',
          durationMs: existing ? Math.max(0, Date.now() - new Date(existing.date).getTime()) : undefined
        }))

        const activeIndex = activeToolKeys.lastIndexOf(activeKey)
        if (activeIndex >= 0) activeToolKeys.splice(activeIndex, 1)
        syncCurrentToolMessage('error')
        return
      }

      if (chunk.type === 'progress') {
        completeThinking()
        if (!currentToolMessageId) return

        const activeKey = getActiveToolKey()
        if (!activeKey) return

        upsertTimelineItem(activeKey, (existing) => ({
          value: existing?.value ?? activeKey,
          slot: existing?.slot ?? `tool-${currentToolTimeline.length}`,
          date: existing?.date ?? new Date().toISOString(),
          title: existing?.title ?? 'Tool',
          description: appendTimelineDetail(existing?.description ?? '', '[progress]', chunk.data),
          icon: existing?.icon ?? 'i-lucide-loader-circle',
          toolState: existing?.toolState ?? 'working',
          durationMs: existing?.durationMs
        }))
        syncCurrentToolMessage('working')
        return
      }

      if (chunk.type === 'interrupt') {
        showPendingApproval(chunk.data)
        return
      }

      if (chunk.type === 'result') {
        completeThinking()
        const reply = chunk.reply || currentTextContent || '(No response)'
        const messageId = enterTextSegment('done')
        currentTextContent = reply
        updateAgentMessage(messageId, message => ({
          ...message,
          content: reply,
          thinking: currentTextThinking,
          thinkingState: currentThinkingState,
          thinkingDurationMs: currentThinkingDurationMs,
          streamState: 'done'
        }))
        return
      }

      throw new Error(chunk.message || `Failed to get response from ${conversation.agent.name}`)
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        handleStreamChunk(JSON.parse(trimmed) as ChatStreamChunk)
      }
    }

    const trailing = buffer.trim()
    if (trailing) {
      handleStreamChunk(JSON.parse(trailing) as ChatStreamChunk)
    }
  } catch (e: any) {
    streamFailed = true
    const errMsg = e?.data?.message || e?.data?.data?.message || e?.message || `Failed to get response from ${agentName}`
    toast.add({
      title: 'Error',
      description: errMsg,
      icon: 'i-lucide-alert-circle',
      color: 'error'
    })

    if (currentToolMessageId) {
      syncCurrentToolMessage('error')
    }
    else if (currentTextMessageId && !currentTextContent) {
      completeThinking()
      updateConversationMessages(conversationId, messages =>
        messages.map(msg => msg.id === currentTextMessageId
          ? {
              ...msg,
              content: `Error: ${errMsg}`,
              thinking: currentTextThinking,
              thinkingState: currentThinkingState,
              thinkingDurationMs: currentThinkingDurationMs,
              streamState: 'error'
            }
          : msg
        )
      )
    } else {
      updateConversationMessages(conversationId, messages => [
        ...messages,
        {
          id: `${conversationId}-a-error-${Date.now()}`,
          role: 'agent',
          content: `Error: ${errMsg}`,
          date: new Date().toISOString(),
          streamState: 'error'
        }
      ])
    }
  } finally {
    if (!streamFailed && currentTextMessageId && !currentTextContent && !currentTextThinking) {
      removeAgentMessage(currentTextMessageId)
    }
    sendLoading.value = false
  }
}

async function onSend(message: string) {
  const conversation = selectedConversation.value
  if (!conversation) return

  const userMsg: ChatMessage = {
    id: `${conversation.id}-u-${Date.now()}`,
    role: 'user',
    content: message,
    date: new Date().toISOString()
  }
  updateConversationMessages(conversation.id, messages => [...messages, userMsg])

  const streamConversation: AgentStreamConversation = {
    id: conversation.id,
    agentId: conversation.agentId,
    agent: { name: conversation.agent.name }
  }
  const body: AgentChatRequestBody = { thread_id: conversation.id, message, stream: true }
  await runAgentStream(streamConversation, body)
}

async function onApprovalDecision(
  messageId: string,
  decisionType: 'approve' | 'edit' | 'comment' | 'reject',
  payload: ChatApprovalEditedAction[] | string = [],
) {
  const conversation = selectedConversation.value
  if (!conversation || sendLoading.value) return

  const editedActions = Array.isArray(payload) ? payload : []
  const approvalComment = typeof payload === 'string' ? payload.trim() : ''
  if (decisionType === 'edit' && editedActions.length === 0) return
  if (decisionType === 'comment' && !approvalComment) return

  let pendingApproval: ChatPendingApproval | undefined
  updateConversationMessages(conversation.id, messages =>
    messages.map((message) => {
      if (message.id !== messageId || !message.pendingApproval || message.pendingApproval.state !== 'pending') return message

      pendingApproval = message.pendingApproval
      return {
        ...message,
        pendingApproval: {
          ...message.pendingApproval,
          state: decisionType === 'approve'
            ? 'approved'
            : decisionType === 'edit'
              ? 'edited'
              : decisionType === 'comment'
                ? 'commented'
                : 'rejected'
        }
      }
    })
  )

  if (!pendingApproval) return

  const decisions: ChatApprovalDecision[] = pendingApproval.actionRequests.map((_, index) => {
    if (decisionType === 'approve') return { type: 'approve' }
    if (decisionType === 'edit') {
      const editedAction = editedActions[index] ?? editedActions[0]
      return { type: 'edit', editedAction: editedAction! }
    }
    if (decisionType === 'comment') return { type: 'comment', message: approvalComment }
    return { type: 'reject', message: shellRejectedMessage }
  })

  const body: AgentChatRequestBody = {
    thread_id: conversation.id,
    resume: { decisions },
    stream: true
  }
  const streamConversation: AgentStreamConversation = {
    id: conversation.id,
    agentId: conversation.agentId,
    agent: { name: conversation.agent.name }
  }
  await runAgentStream(streamConversation, body)
}

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg')

const addAgentModalOpen = ref(false)
const removeModalOpen = ref(false)
const removeLoading = ref(false)
const agentToRemove = ref<AgentConversation | null>(null)

async function onAgentCreated(newAgentId: string) {
  await refreshChats()
  selectedConversationId.value = newAgentId
  setTimeout(() => {
    openAgentSystemEditor(newAgentId)
  }, 100)
}

const chatPanelRef = ref()
function openAgentSystemEditor(_: string) {
  if (chatPanelRef.value?.openAgentFiles) {
    chatPanelRef.value.openAgentFiles('identity.ts')
  }
}

function promptDeleteAgent(conversation: AgentConversation) {
  agentToRemove.value = conversation
  removeModalOpen.value = true
}

function clearDeletedAgentState(agentId: string) {
  if (selectedConversationId.value === agentId) {
    selectedConversationId.value = null
  }

  agentMessagesMap.value = Object.fromEntries(
    Object.entries(agentMessagesMap.value).filter(([threadId]) => threadId !== agentId)
  )
}

async function confirmDeleteAgent() {
  const conversation = agentToRemove.value
  if (!conversation || removeLoading.value) return

  removeLoading.value = true
  try {
    await $fetch(`/api/agents/${conversation.agentId}`, { method: 'DELETE' })
    clearDeletedAgentState(conversation.id)
    await refreshChats()
    toast.add({
      title: 'Agent deleted',
      description: `${conversation.agent.name} has been removed.`,
      color: 'success'
    })
    removeModalOpen.value = false
    agentToRemove.value = null
  } catch (e: any) {
    toast.add({
      title: 'Delete failed',
      description: e?.data?.message || e?.message || 'Failed to delete agent',
      color: 'error'
    })
  } finally {
    removeLoading.value = false
  }
}

watch(removeModalOpen, (isOpen) => {
  if (!isOpen && !removeLoading.value) {
    agentToRemove.value = null
  }
})
</script>

<template>
  <UDashboardPanel
    id="agents-1"
    :default-size="25"
    :min-size="20"
    :max-size="30"
    resizable
  >
    <UDashboardNavbar title="Agents">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="ghost"
            size="sm"
            @click="addAgentModalOpen = true"
          />
          <UBadge :label="threads.length" variant="subtle" />
        </div>
      </template>
    </UDashboardNavbar>
    <AgentList
      v-model="selectedConversationId"
      :conversations="threads"
      :on-remove="promptDeleteAgent"
    />
  </UDashboardPanel>

  <UDashboardPanel id="agents-2" :default-size="75" :min-size="50" class="flex flex-1 flex-col min-w-0 w-full">
    <AgentChat
      v-if="displayConversation"
      :key="displayConversation.id"
      ref="chatPanelRef"
      embedded
      :conversation="displayConversation"
      :send-loading="sendLoading"
      @close="selectedConversationId = null"
      @delete-agent="promptDeleteAgent(displayConversation)"
      @approval-decision="onApprovalDecision"
      @send="onSend"
    />
    <div v-else class="flex flex-1 flex-col items-center justify-center min-h-0 p-6">
      <UIcon name="i-lucide-users" class="size-32 text-dimmed" />
      <p class="mt-4 text-dimmed text-sm">Select a conversation to open the chat</p>
    </div>
  </UDashboardPanel>

  <ClientOnly>
    <USlideover v-if="isMobile" v-model:open="isChatPanelOpen">
      <template #content>
        <AgentChat
          v-if="displayConversation"
          :key="displayConversation.id"
          :conversation="displayConversation"
          :send-loading="sendLoading"
          @close="selectedConversationId = null"
          @delete-agent="promptDeleteAgent(displayConversation)"
          @approval-decision="onApprovalDecision"
          @send="onSend"
        />
      </template>
    </USlideover>
  </ClientOnly>

  <AgentAddAgentModal v-model:open="addAgentModalOpen" @created="onAgentCreated" />

  <UModal
    v-model:open="removeModalOpen"
    :title="`Delete ${agentToRemove?.agent.name ?? 'agent'}?`"
    :description="'This removes the agent folder and unregisters it from the platform.'"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <p class="text-sm text-dimmed">
          This action cannot be undone.
        </p>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            :disabled="removeLoading"
            @click="removeModalOpen = false"
          />
          <UButton
            label="Delete"
            icon="i-lucide-trash-2"
            color="error"
            :loading="removeLoading"
            @click="confirmDeleteAgent"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>

<style scoped>
:deep(#agents-2) {
  flex: 1 1 0%;
  min-width: 0;
}
</style>
