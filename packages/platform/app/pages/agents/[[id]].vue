<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { AgentConversation, ChatMessage, ChatTimelineItem } from '~/types'

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
    | { type: 'result', reply: string }
    | { type: 'error', message: string }

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

  sendLoading.value = true
  const initialAgentMessageId = `${conversation.id}-a-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  updateConversationMessages(conversation.id, messages => [
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
  let currentToolMessageId: string | null = null
  try {
    const response = await fetch(`/api/agents/${conversation.agentId}/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/x-ndjson'
      },
      body: JSON.stringify({ thread_id: conversation.id, message, stream: true })
    })

    if (!response.ok || !response.body) {
      throw new Error(await response.text() || 'Failed to start response stream')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let currentToolTimeline: ChatTimelineItem[] = []
    let currentToolTimelineIndexByKey = new Map<string, number>()
    let activeToolKeys: string[] = []

    function appendAgentMessage(message: ChatMessage): string {
      updateConversationMessages(conversation.id, messages => [...messages, message])
      return message.id
    }

    function updateAgentMessage(
      messageId: string,
      updater: (message: ChatMessage) => ChatMessage,
    ) {
      updateConversationMessages(conversation.id, messages =>
        messages.map(msg => msg.id === messageId ? updater(msg) : msg)
      )
    }

    function createAgentTextMessage(initialContent = '', streamState: ChatMessage['streamState'] = 'working'): string {
      const id = `${conversation.id}-a-text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      currentTextMessageId = appendAgentMessage({
        id,
        role: 'agent',
        content: initialContent,
        thinking: '',
        date: new Date().toISOString(),
        streamState
      })
      currentTextContent = initialContent
      currentTextThinking = ''
      return currentTextMessageId
    }

    function createAgentToolMessage(streamState: ChatMessage['streamState'] = 'working'): string {
      const id = `${conversation.id}-a-tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

    function syncCurrentToolMessage(streamState: ChatMessage['streamState']) {
      if (!currentToolMessageId) return

      updateAgentMessage(currentToolMessageId, message => ({
        ...message,
        timeline: [...currentToolTimeline],
        streamState
      }))
    }

    const handleStreamChunk = (chunk: ChatStreamChunk) => {
      if (chunk.type === 'thinking') {
        const messageId = enterTextSegment('working')
        currentTextThinking += chunk.delta
        updateAgentMessage(messageId, message => ({
          ...message,
          thinking: currentTextThinking,
          streamState: 'working'
        }))
        return
      }

      if (chunk.type === 'message') {
        const messageId = enterTextSegment('working')
        currentTextContent += chunk.delta
        updateAgentMessage(messageId, message => ({
          ...message,
          content: currentTextContent,
          thinking: currentTextThinking,
          streamState: 'working'
        }))
        return
      }

      if (chunk.type === 'tool') {
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
            icon: 'i-lucide-loader-circle'
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
            icon: 'i-lucide-loader-circle'
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
            icon: 'i-lucide-circle-check'
          }))

          const activeIndex = activeToolKeys.lastIndexOf(activeKey)
          if (activeIndex >= 0) activeToolKeys.splice(activeIndex, 1)
          syncCurrentToolMessage(activeToolKeys.length > 0 ? 'working' : 'done')
          return
        }

        const activeKey = currentToolTimelineIndexByKey.has(key) ? key : getActiveToolKey() ?? key
        upsertTimelineItem(activeKey, (existing) => ({
          value: existing?.value ?? activeKey,
          slot: existing?.slot ?? `tool-${currentToolTimeline.length}`,
          date: existing?.date ?? new Date().toISOString(),
          title: existing?.title ?? event.name,
          description: appendTimelineDetail(existing?.description ?? '', '[error]', event.error),
          icon: 'i-lucide-circle-alert'
        }))

        const activeIndex = activeToolKeys.lastIndexOf(activeKey)
        if (activeIndex >= 0) activeToolKeys.splice(activeIndex, 1)
        syncCurrentToolMessage('error')
        return
      }

      if (chunk.type === 'progress') {
        if (!currentToolMessageId) return

        const activeKey = getActiveToolKey()
        if (!activeKey) return

        upsertTimelineItem(activeKey, (existing) => ({
          value: existing?.value ?? activeKey,
          slot: existing?.slot ?? `tool-${currentToolTimeline.length}`,
          date: existing?.date ?? new Date().toISOString(),
          title: existing?.title ?? 'Tool',
          description: appendTimelineDetail(existing?.description ?? '', '[progress]', chunk.data),
          icon: existing?.icon ?? 'i-lucide-loader-circle'
        }))
        syncCurrentToolMessage('working')
        return
      }

      if (chunk.type === 'result') {
        const reply = chunk.reply || currentTextContent || '(No response)'
        const messageId = enterTextSegment('done')
        currentTextContent = reply
        updateAgentMessage(messageId, message => ({
          ...message,
          content: reply,
          thinking: currentTextThinking,
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
    const errMsg = e?.data?.message || e?.data?.data?.message || e?.message || `Failed to get response from ${conversation.agent.name}`
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
      updateConversationMessages(conversation.id, messages =>
        messages.map(msg => msg.id === currentTextMessageId
          ? { ...msg, content: `Error: ${errMsg}`, thinking: currentTextThinking, streamState: 'error' }
          : msg
        )
      )
    } else {
      updateConversationMessages(conversation.id, messages => [
        ...messages,
        {
          id: `${conversation.id}-a-error-${Date.now()}`,
          role: 'agent',
          content: `Error: ${errMsg}`,
          date: new Date().toISOString(),
          streamState: 'error'
        }
      ])
    }
  } finally {
    sendLoading.value = false
  }
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
