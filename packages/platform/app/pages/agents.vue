<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { AgentConversation, ChatMessage } from '~/types'

const tabItems = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' }
]
const selectedTab = ref('all')

const { data: chatsData, refresh: refreshChats } = await useFetch<AgentConversation[]>('/api/agents/chats', { default: () => [] })

function findConversationById(conversations: AgentConversation[], id: string): AgentConversation | null {
  for (const conversation of conversations) {
    if (conversation.id === id) return conversation
  }

  return null
}

/** Threads: one per agent from API, plus new threads from "New chat". Keyed by thread id so each chat has its own messages. */
const threads = ref<AgentConversation[]>([])
watch(chatsData, (data) => {
  threads.value = data ? [...data] : []
}, { immediate: true })

const filteredConversations = ref<AgentConversation[]>([])
watch([threads, selectedTab], ([conversations, tab]) => {
  filteredConversations.value = tab === 'unread'
    ? conversations.filter((conversation) => !!conversation.unread)
    : conversations
}, { immediate: true })

const selectedConversationId = ref<string | null>(null)

const selectedConversation = ref<AgentConversation | null>(null)
watch([filteredConversations, selectedConversationId], ([conversations, selectedId]) => {
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

watch(filteredConversations, () => {
  if (selectedConversationId.value && !findConversationById(filteredConversations.value, selectedConversationId.value)) {
    selectedConversationId.value = null
  }
})

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

const addAgentModalOpen = ref(false)
const removeModalOpen = ref(false)
const removeLoading = ref(false)
const agentToRemove = ref<AgentConversation | null>(null)

async function onAgentCreated(newAgentId: string) {
  await refreshChats()
  selectedConversationId.value = newAgentId
  // Small delay to let chat component mount
  setTimeout(() => {
    openAgentSystemEditor(newAgentId)
  }, 100)
}

const chatPanelRef = ref()
function openAgentSystemEditor(agentId: string) {
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
        <UBadge :label="filteredConversations.length" variant="subtle" />
      </template>

      <template #right>
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="ghost"
          size="sm"
          class="me-2"
          @click="addAgentModalOpen = true"
        />
        <UTabs
          v-model="selectedTab"
          :items="tabItems"
          :content="false"
          size="xs"
        />
      </template>
    </UDashboardNavbar>
    <AgentList
      v-model="selectedConversationId"
      :conversations="filteredConversations"
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
/* Ensure chat panel grows to fill remaining width in dashboard layout */
:deep(#agents-2) {
  flex: 1 1 0%;
  min-width: 0;
}
</style>
