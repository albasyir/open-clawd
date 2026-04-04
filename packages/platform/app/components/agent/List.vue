<script setup lang="ts">
import { format, isToday } from 'date-fns'
import type { AgentConversation } from '~/types'

const props = defineProps<{
  conversations: AgentConversation[]
}>()

const conversationsRefs = ref<Record<string, Element | null>>({})

const selectedConversationId = defineModel<string | null>()

function lastMessagePreview(conversation: AgentConversation) {
  const last = conversation.messages[conversation.messages.length - 1]
  if (!last) return 'No messages yet'
  const text = last.content
  return text.length > 60 ? `${text.slice(0, 60)}...` : text
}

watch(selectedConversationId, () => {
  if (!selectedConversationId.value) return
  const ref = conversationsRefs.value[selectedConversationId.value]
  if (ref) ref.scrollIntoView({ block: 'nearest' })
})

defineShortcuts({
  arrowdown: () => {
    const index = props.conversations.findIndex(c => c.id === selectedConversationId.value)
    if (index === -1) selectedConversationId.value = props.conversations[0]?.id ?? null
    else if (index < props.conversations.length - 1) selectedConversationId.value = props.conversations[index + 1]?.id ?? null
  },
  arrowup: () => {
    const index = props.conversations.findIndex(c => c.id === selectedConversationId.value)
    if (index === -1) selectedConversationId.value = props.conversations[props.conversations.length - 1]?.id ?? null
    else if (index > 0) selectedConversationId.value = props.conversations[index - 1]?.id ?? null
  }
})
</script>

<template>
  <div class="overflow-y-auto divide-y divide-default">
    <div
      v-for="(conversation, index) in conversations"
      :key="conversation.id"
      :ref="(el) => { conversationsRefs[conversation.id] = el as Element | null }"
    >
      <div
        class="p-4 sm:px-6 text-sm cursor-pointer border-l-2 transition-colors"
        :class="[
          conversation.unread ? 'text-highlighted' : 'text-toned',
          selectedConversationId === conversation.id
            ? 'border-primary bg-primary/10'
            : 'border-bg hover:border-primary hover:bg-primary/5'
        ]"
        @click="selectedConversationId = conversation.id"
      >
        <div class="flex items-center justify-between" :class="[conversation.unread && 'font-semibold']">
          <div class="flex items-center gap-3">
            {{ conversation.agent.name }}
            <UChip v-if="conversation.unread" />
          </div>
          <span>{{ isToday(new Date(conversation.updatedAt)) ? format(new Date(conversation.updatedAt), 'HH:mm') : format(new Date(conversation.updatedAt), 'dd MMM') }}</span>
        </div>
        <p class="truncate text-dimmed line-clamp-1 mt-0.5">
          {{ lastMessagePreview(conversation) }}
        </p>
      </div>
    </div>
  </div>
</template>
