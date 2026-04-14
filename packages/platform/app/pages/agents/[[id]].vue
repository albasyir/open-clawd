<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { AgentConversation, ChatMessage } from '~/types'

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

function formatToolStreamEvent(event: ChatToolStreamEvent): string {
  if (event.event === 'on_tool_start') {
    const details = event.input == null ? '' : `\n${formatStreamData(event.input)}`
    return `[tool:start] ${event.name}${details}`
  }

  if (event.event === 'on_tool_event') {
    const details = event.data == null ? '' : `\n${formatStreamData(event.data)}`
    return `[tool:progress] ${event.name}${details}`
  }

  if (event.event === 'on_tool_end') {
    const details = event.output == null ? '' : `\n${formatStreamData(event.output)}`
    return `[tool:end] ${event.name}${details}`
  }

  const details = event.error == null ? '' : `\n${formatStreamData(event.error)}`
  return `[tool:error] ${event.name}${details}`
}

function formatAgentStreamContent(progressEntries: string[], reply: string): string {
  const trimmedReply = reply.trim()
  const progressBlock = progressEntries.join('\n\n').trim()

  if (progressBlock && trimmedReply) {
    return `Progress:\n${progressBlock}\n\nResponse:\n${trimmedReply}`
  }

  if (progressBlock) {
    return `Progress:\n${progressBlock}`
  }

  if (trimmedReply) {
    return trimmedReply
  }

  return 'Working...'
}

function updateStreamedAgentMessage(
  conversationId: string,
  agentMessageId: string,
  progressEntries: string[],
  reply: string,
) {
  const content = formatAgentStreamContent(progressEntries, reply)
  updateConversationMessages(conversationId, messages =>
    messages.map(msg => msg.id === agentMessageId ? { ...msg, content } : msg)
  )
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

  const agentMessageId = `${conversation.id}-a-${Date.now()}`
  const agentMsg: ChatMessage = {
    id: agentMessageId,
    role: 'agent',
    content: 'Working...',
    date: new Date().toISOString()
  }
  updateConversationMessages(conversation.id, messages => [...messages, agentMsg])

  sendLoading.value = true
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
    let finalReply = ''
    const progressEntries: string[] = []

    const handleStreamChunk = (chunk: ChatStreamChunk) => {
      if (chunk.type === 'message') {
        finalReply += chunk.delta
        updateStreamedAgentMessage(conversation.id, agentMessageId, progressEntries, finalReply)
        return
      }

      if (chunk.type === 'tool') {
        progressEntries.push(formatToolStreamEvent(chunk.event))
        updateStreamedAgentMessage(conversation.id, agentMessageId, progressEntries, finalReply)
        return
      }

      if (chunk.type === 'progress') {
        progressEntries.push(formatStreamData(chunk.data))
        updateStreamedAgentMessage(conversation.id, agentMessageId, progressEntries, finalReply)
        return
      }

      if (chunk.type === 'result') {
        finalReply = chunk.reply || finalReply || '(No response)'
        updateStreamedAgentMessage(conversation.id, agentMessageId, progressEntries, finalReply)
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

    updateStreamedAgentMessage(conversation.id, agentMessageId, progressEntries, finalReply || '(No response)')
  } catch (e: any) {
    const errMsg = e?.data?.message || e?.data?.data?.message || e?.message || `Failed to get response from ${conversation.agent.name}`
    toast.add({
      title: 'Error',
      description: errMsg,
      icon: 'i-lucide-alert-circle',
      color: 'error'
    })
    updateStreamedAgentMessage(conversation.id, agentMessageId, [`[error] ${errMsg}`], '')
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
