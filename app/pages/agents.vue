<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { AgentConversation, ChatMessage } from '~/types'

const tabItems = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' }
]
const selectedTab = ref('all')

const { data: chatsData } = await useFetch<AgentConversation[]>('/api/agents/chats', { default: () => [] })

/** Threads: one per agent from API, plus new threads from "New chat". Keyed by thread id so each chat has its own messages. */
const threads = ref<AgentConversation[]>([])
watch(chatsData, (data) => {
  if (data?.length && threads.value.length === 0) {
    threads.value = [...data]
  }
}, { immediate: true })

const filteredConversations = computed(() => {
  const list = threads.value
  return (selectedTab.value === 'unread' ? list.filter(c => !!c.unread) : list) as AgentConversation[]
})

const selectedConversationId = ref<string | null>(null)

const selectedConversation = computed(() => {
  if (!selectedConversationId.value) return null
  return filteredConversations.value.find(c => c.id === selectedConversationId.value) ?? null
})

/** Live messages per thread id (each chat has its own history). */
const agentMessagesMap = ref<Record<string, ChatMessage[]>>({})

/** Conversation to pass to chat: use live messages from map, else list data. */
const displayConversation = computed(() => {
  const c = selectedConversation.value
  if (!c) return null
  const messages = agentMessagesMap.value[c.id] ?? c.messages
  return { ...c, messages }
})

const isChatPanelOpen = computed({
  get: () => !!selectedConversationId.value,
  set: (value: boolean) => {
    if (!value) selectedConversationId.value = null
  }
})

watch(filteredConversations, () => {
  if (selectedConversationId.value && !filteredConversations.value.find(c => c.id === selectedConversationId.value)) {
    selectedConversationId.value = null
  }
})

function startNewChat() {
  const c = selectedConversation.value
  if (!c) return
  const newThread: AgentConversation = {
    id: crypto.randomUUID(),
    agentId: c.agentId,
    agent: c.agent,
    messages: [],
    updatedAt: new Date().toISOString()
  }
  threads.value = [...threads.value, newThread]
  selectedConversationId.value = newThread.id
}

const toast = useToast()
const sendLoading = ref(false)

async function onSend(message: string) {
  const c = selectedConversation.value
  if (!c) return

  const userMsg: ChatMessage = {
    id: `${c.id}-u-${Date.now()}`,
    role: 'user',
    content: message,
    date: new Date().toISOString()
  }
  const prev = agentMessagesMap.value[c.id] ?? []
  agentMessagesMap.value = { ...agentMessagesMap.value, [c.id]: [...prev, userMsg] }

  sendLoading.value = true
  try {
    const { reply } = await $fetch<{ reply: string }>(`/api/agents/${c.agentId}/chat`, {
      method: 'POST',
      body: { thread_id: c.id, message }
    })
    const agentMsg: ChatMessage = {
      id: `${c.id}-a-${Date.now()}`,
      role: 'agent',
      content: reply || '(No response)',
      date: new Date().toISOString()
    }
    agentMessagesMap.value = {
      ...agentMessagesMap.value,
      [c.id]: [...(agentMessagesMap.value[c.id] ?? []), agentMsg]
    }
  } catch (e: any) {
    const errMsg = e?.data?.message || e?.data?.data?.message || e?.message || `Failed to get response from ${c.agent.name}`
    toast.add({
      title: 'Error',
      description: errMsg,
      icon: 'i-lucide-alert-circle',
      color: 'error'
    })
    const agentMsg: ChatMessage = {
      id: `${c.id}-a-${Date.now()}`,
      role: 'agent',
      content: `Error: ${errMsg}`,
      date: new Date().toISOString()
    }
    agentMessagesMap.value = {
      ...agentMessagesMap.value,
      [c.id]: [...(agentMessagesMap.value[c.id] ?? []), agentMsg]
    }
  } finally {
    sendLoading.value = false
  }
}

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg')
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
        <UBadge :label="filteredConversations.length" variant="subtle" />
      </template>

      <template #right>
        <UTabs
          v-model="selectedTab"
          :items="tabItems"
          :content="false"
          size="xs"
        />
      </template>
    </UDashboardNavbar>
    <AgentList v-model="selectedConversationId" :conversations="filteredConversations" />
  </UDashboardPanel>

  <UDashboardPanel id="agents-2" :default-size="75" :min-size="50" class="flex flex-1 flex-col min-w-0 w-full">
    <AgentChat
      v-if="displayConversation"
      :key="displayConversation.id"
      embedded
      :conversation="displayConversation"
      :send-loading="sendLoading"
      @close="selectedConversationId = null"
      @new-chat="startNewChat"
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
          @new-chat="startNewChat"
          @send="onSend"
        />
      </template>
    </USlideover>
  </ClientOnly>
</template>

<style scoped>
/* Ensure chat panel grows to fill remaining width in dashboard layout */
:deep(#agents-2) {
  flex: 1 1 0%;
  min-width: 0;
}
</style>
