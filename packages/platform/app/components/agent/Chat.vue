<script setup lang="ts">
import { format } from 'date-fns'
import type { AgentConversation, ChatMessage, ChatTimelineItem } from '~/types'

const props = withDefaults(
  defineProps<{
    conversation: AgentConversation
    /** When true, render only inner content (no panel wrapper). Use when parent provides UDashboardPanel. */
    embedded?: boolean
    /** When true, parent is sending (e.g. real agent request). Disables input and shows loading. */
    sendLoading?: boolean
  }>(),
  { embedded: false, sendLoading: false }
)

const emit = defineEmits<{
  close: []
  send: [message: string]
  newChat: []
  deleteAgent: []
}>()

const message = ref('')
const localSending = ref(false)
const filesSlideoverOpen = ref(false)
const toolsSlideoverOpen = ref(false)
const thinkingOpen = ref<Record<string, boolean>>({})
const toolCallOpen = ref<Record<string, boolean>>({})

const loading = computed(() => localSending.value || !!props.sendLoading)

function formatTimelineDate(date: string) {
  return format(new Date(date), 'HH:mm:ss')
}

function shouldShowWorkingState(message: ChatMessage) {
  return message.role === 'agent'
    && message.streamState === 'working'
    && !message.content.trim()
    && !message.thinking?.trim()
}

function hasTimeline(message: ChatMessage) {
  return message.role === 'agent' && !!message.timeline?.length
}

function hasThinking(message: ChatMessage) {
  return message.role === 'agent' && !!message.thinking?.trim()
}

function isThinkingOpen(messageId: string) {
  return !!thinkingOpen.value[messageId]
}

function toggleThinking(messageId: string) {
  thinkingOpen.value = {
    ...thinkingOpen.value,
    [messageId]: !thinkingOpen.value[messageId]
  }
}

function getToolCallKey(messageId: string, itemValue: string) {
  return `${messageId}:${itemValue}`
}

function isToolCallOpen(messageId: string, itemValue: string) {
  return !!toolCallOpen.value[getToolCallKey(messageId, itemValue)]
}

function toggleToolCall(messageId: string, itemValue: string) {
  const key = getToolCallKey(messageId, itemValue)
  toolCallOpen.value = {
    ...toolCallOpen.value,
    [key]: !toolCallOpen.value[key]
  }
}

function formatDuration(durationMs?: number) {
  if (durationMs == null) return null

  const seconds = durationMs / 1000
  const roundedSeconds = seconds >= 10
    ? Math.round(seconds)
    : Math.round(seconds * 10) / 10
  const label = Number.isInteger(roundedSeconds) ? roundedSeconds.toString() : roundedSeconds.toFixed(1)

  return `${label} second${roundedSeconds === 1 ? '' : 's'}`
}

function getThinkingLabel(message: ChatMessage) {
  if (message.thinkingState === 'done') {
    const duration = formatDuration(message.thinkingDurationMs)
    return duration ? `Thought for ${duration}` : 'Thought'
  }

  return 'Thinking'
}

function getToolCallLabel(item: ChatTimelineItem) {
  if (item.toolState === 'done') {
    const duration = formatDuration(item.durationMs)
    return duration ? `${item.title} executed for ${duration}` : `${item.title} executed`
  }

  if (item.toolState === 'error') {
    const duration = formatDuration(item.durationMs)
    return duration ? `${item.title} failed after ${duration}` : `${item.title} failed`
  }

  return `Executing ${item.title}`
}

function getToolCallIcon(item: ChatTimelineItem) {
  return 'i-lucide-wrench'
}

function getToolCallIconClass(item: ChatTimelineItem) {
  if (item.toolState === 'done') return 'text-primary/80'
  if (item.toolState === 'error') return 'text-error/80'
  return 'animate-pulse text-primary/80'
}

function shouldRenderBubble(message: ChatMessage) {
  return message.role === 'user'
}

function shouldRenderAgentContent(message: ChatMessage) {
  return message.role === 'agent' && (!!message.content.trim() || shouldShowWorkingState(message) || !hasTimeline(message))
}

function onSubmit() {
  const text = message.value.trim()
  if (!text || loading.value) return

  localSending.value = true
  emit('send', text)
  message.value = ''

  setTimeout(() => {
    localSending.value = false
  }, 500)
}

const filesSlideoverInitialFile = ref<string>()

function openAgentFiles(fileId?: string) {
  filesSlideoverInitialFile.value = fileId
  filesSlideoverOpen.value = true
}

defineExpose({
  openAgentFiles
})
</script>

<template>
  <UDashboardPanel
    v-if="!embedded"
    id="agents-2"
    :default-size="75"
    :min-size="50"
  >
    <UDashboardNavbar :toggle="false">
      <template #title>
        <UAvatar
          v-bind="conversation.agent.avatar"
          :alt="conversation.agent.name"
          size="xl"
        />
        <div class="min-w-0">
          <p class="font-semibold text-highlighted">
            {{ conversation.agent.name }}
          </p>
        </div>
      </template>
      <template #leading>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          class="-ms-1.5"
          @click="emit('close')"
        />
      </template>
      <template #right>
        <UTooltip text="Delete agent">
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            @click="emit('deleteAgent')"
          />
        </UTooltip>
        <UTooltip text="Manage Agent System">
          <UButton
            icon="i-lucide-code"
            color="neutral"
            variant="ghost"
            @click="filesSlideoverOpen = true"
          />
        </UTooltip>
        <UTooltip text="Manage tools">
          <UButton
            icon="i-lucide-wrench"
            color="neutral"
            variant="ghost"
            @click="toolsSlideoverOpen = true"
          />
        </UTooltip>
      </template>
    </UDashboardNavbar>

    <div class="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col gap-4 min-h-0">
      <div
        v-for="msg in conversation.messages"
        :key="msg.id"
        class="flex gap-3"
        :class="msg.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <UAvatar
          v-if="msg.role === 'agent'"
          v-bind="conversation.agent.avatar"
          :alt="conversation.agent.name"
          size="md"
          class="shrink-0"
        />
        <div
          v-else
          class="size-9 shrink-0 rounded-full bg-primary/20 flex items-center justify-center"
        >
          <UIcon name="i-lucide-user" class="size-4 text-primary" />
        </div>
        <div
          class="max-w-[85%] min-w-0"
        >
          <div v-if="hasTimeline(msg)" class="mb-2 space-y-2">
            <div
              v-for="item in (msg.timeline || [])"
              :key="`${msg.id}-${item.value}`"
              class="rounded-lg border border-primary/15 bg-primary/5"
            >
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                @click="toggleToolCall(msg.id, String(item.value))"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <UIcon
                    :name="getToolCallIcon(item)"
                    class="size-4 shrink-0"
                    :class="getToolCallIconClass(item)"
                  />
                  <span class="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-primary/80">
                    {{ getToolCallLabel(item) }}
                  </span>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <span class="text-[11px] text-dimmed">
                    {{ formatTimelineDate(item.date) }}
                  </span>
                  <UIcon
                    name="i-lucide-chevron-down"
                    class="size-4 text-primary/70 transition-transform"
                    :class="isToolCallOpen(msg.id, String(item.value)) ? 'rotate-180' : ''"
                  />
                </div>
              </button>
              <div v-if="isToolCallOpen(msg.id, String(item.value))" class="border-t border-primary/10 px-3 py-2">
                <p class="whitespace-pre-wrap text-xs text-toned">
                  {{ item.description }}
                </p>
              </div>
            </div>
          </div>
          <div v-if="shouldRenderAgentContent(msg)" class="px-1 py-0.5">
            <div v-if="hasThinking(msg)" class="mb-3 rounded-lg border border-primary/15 bg-primary/5">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                @click="toggleThinking(msg.id)"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <UIcon name="i-lucide-brain" class="size-4 shrink-0 text-primary/80" />
                  <span class="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-primary/80">
                    {{ getThinkingLabel(msg) }}
                  </span>
                </div>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 text-primary/70 transition-transform"
                  :class="isThinkingOpen(msg.id) ? 'rotate-180' : ''"
                />
              </button>
              <div v-if="isThinkingOpen(msg.id)" class="border-t border-primary/10 px-3 py-2">
                <p class="whitespace-pre-wrap text-xs text-toned">
                  {{ msg.thinking }}
                </p>
              </div>
            </div>
            <p v-if="msg.content" class="whitespace-pre-wrap text-sm text-toned">
              {{ msg.content }}
            </p>
            <div v-else-if="shouldShowWorkingState(msg)" class="space-y-2 py-0.5">
              <USkeleton class="h-3.5 w-20 rounded-full bg-primary/25 ring-1 ring-primary/10" />
              <USkeleton class="h-3.5 w-52 rounded-full bg-primary/20 ring-1 ring-primary/10" />
              <USkeleton class="h-3.5 w-36 rounded-full bg-primary/15 ring-1 ring-primary/10" />
            </div>
            <p v-if="!shouldShowWorkingState(msg)" class="mt-1 text-xs text-dimmed">
              {{ format(new Date(msg.date), 'HH:mm') }}
            </p>
          </div>
          <div
            v-if="shouldRenderBubble(msg)"
            class="rounded-2xl px-4 py-2.5"
            :class="msg.role === 'user'
              ? 'bg-primary text-primary-foreground rounded-tr-sm'
              : 'bg-elevated rounded-tl-sm'"
          >
            <p class="whitespace-pre-wrap text-sm">
              {{ msg.content }}
            </p>
            <p class="text-xs mt-1 text-primary-foreground/80">
              {{ format(new Date(msg.date), 'HH:mm') }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="pb-4 px-4 sm:px-6 shrink-0">
      <UCard variant="subtle" class="mt-auto" :ui="{ header: 'flex items-center gap-1.5 text-dimmed' }">
        <template #header>
          <UIcon name="i-lucide-message-circle" class="size-5" />
          <span class="text-sm truncate">Message {{ conversation.agent.name }}</span>
        </template>
        <form @submit.prevent="onSubmit">
          <UTextarea
            v-model="message"
            color="neutral"
            variant="none"
            autoresize
            placeholder="Type your message..."
            :rows="2"
            class="w-full"
            :ui="{ base: 'p-0 resize-none' }"
            @keydown.enter.exact.prevent="onSubmit"
          />
          <div class="flex justify-end gap-2 mt-2">
            <UButton
              type="submit"
              color="primary"
              :loading="loading"
              label="Send"
              icon="i-lucide-send"
            />
          </div>
        </form>
      </UCard>
    </div>
  </UDashboardPanel>

  <div v-else class="flex h-full w-full min-h-0 min-w-0 flex-col">
    <UDashboardNavbar :title="conversation.agent.name" :toggle="false">
      <template #title>
        <UAvatar
          v-bind="conversation.agent.avatar"
          :alt="conversation.agent.name"
          size="xl"
        />
        <div class="min-w-0">
          <p class="font-semibold text-highlighted">
            {{ conversation.agent.name }}
          </p>
        </div>
      </template>

      <template #leading>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          class="-ms-1.5"
          @click="emit('close')"
        />
      </template>
      <template #right>
        <UTooltip text="Delete agent">
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            @click="emit('deleteAgent')"
          />
        </UTooltip>
        <UTooltip text="Manage Agent System">
          <UButton
            icon="i-lucide-code"
            color="neutral"
            variant="ghost"
            @click="filesSlideoverOpen = true"
          />
        </UTooltip>
        <UTooltip text="Manage tools">
          <UButton
            icon="i-lucide-wrench"
            color="neutral"
            variant="ghost"
            @click="toolsSlideoverOpen = true"
          />
        </UTooltip>
      </template>
    </UDashboardNavbar>

    <div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col gap-4">
      <div
        v-for="msg in conversation.messages"
        :key="msg.id"
        class="flex gap-3"
        :class="msg.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <UAvatar
          v-if="msg.role === 'agent'"
          v-bind="conversation.agent.avatar"
          :alt="conversation.agent.name"
          size="md"
          class="shrink-0"
        />
        <div v-else class="bg-primary/20 flex size-9 shrink-0 items-center justify-center rounded-full">
          <UIcon name="i-lucide-user" class="size-4 text-primary" />
        </div>
        <div class="max-w-[85%] min-w-0">
          <div v-if="hasTimeline(msg)" class="mb-2 space-y-2">
            <div
              v-for="item in (msg.timeline || [])"
              :key="`${msg.id}-${item.value}-mobile`"
              class="rounded-lg border border-primary/15 bg-primary/5"
            >
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                @click="toggleToolCall(msg.id, String(item.value))"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <UIcon
                    :name="getToolCallIcon(item)"
                    class="size-4 shrink-0"
                    :class="getToolCallIconClass(item)"
                  />
                  <span class="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-primary/80">
                    {{ getToolCallLabel(item) }}
                  </span>
                </div>
                <div class="flex shrink-0 items-center gap-2">
                  <span class="text-[11px] text-dimmed">
                    {{ formatTimelineDate(item.date) }}
                  </span>
                  <UIcon
                    name="i-lucide-chevron-down"
                    class="size-4 text-primary/70 transition-transform"
                    :class="isToolCallOpen(msg.id, String(item.value)) ? 'rotate-180' : ''"
                  />
                </div>
              </button>
              <div v-if="isToolCallOpen(msg.id, String(item.value))" class="border-t border-primary/10 px-3 py-2">
                <p class="whitespace-pre-wrap text-xs text-toned">
                  {{ item.description }}
                </p>
              </div>
            </div>
          </div>
          <div v-if="shouldRenderAgentContent(msg)" class="px-1 py-0.5">
            <div v-if="hasThinking(msg)" class="mb-3 rounded-lg border border-primary/15 bg-primary/5">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                @click="toggleThinking(msg.id)"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <UIcon name="i-lucide-brain" class="size-4 shrink-0 text-primary/80" />
                  <span class="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-primary/80">
                    {{ getThinkingLabel(msg) }}
                  </span>
                </div>
                <UIcon
                  name="i-lucide-chevron-down"
                  class="size-4 text-primary/70 transition-transform"
                  :class="isThinkingOpen(msg.id) ? 'rotate-180' : ''"
                />
              </button>
              <div v-if="isThinkingOpen(msg.id)" class="border-t border-primary/10 px-3 py-2">
                <p class="whitespace-pre-wrap text-xs text-toned">
                  {{ msg.thinking }}
                </p>
              </div>
            </div>
            <p v-if="msg.content" class="whitespace-pre-wrap text-sm text-toned">
              {{ msg.content }}
            </p>
            <div v-else-if="shouldShowWorkingState(msg)" class="space-y-2 py-0.5">
              <USkeleton class="h-3.5 w-20 rounded-full bg-primary/25 ring-1 ring-primary/10" />
              <USkeleton class="h-3.5 w-52 rounded-full bg-primary/20 ring-1 ring-primary/10" />
              <USkeleton class="h-3.5 w-36 rounded-full bg-primary/15 ring-1 ring-primary/10" />
            </div>
            <p v-if="!shouldShowWorkingState(msg)" class="mt-1 text-xs text-dimmed">
              {{ format(new Date(msg.date), 'HH:mm') }}
            </p>
          </div>
          <div
            v-if="shouldRenderBubble(msg)"
            class="rounded-2xl px-4 py-2.5"
            :class="msg.role === 'user' ? 'rounded-tr-sm bg-primary text-primary-foreground' : 'rounded-tl-sm bg-elevated'"
          >
            <p class="whitespace-pre-wrap text-sm">
              {{ msg.content }}
            </p>
            <p class="mt-1 text-xs text-primary-foreground/80">
              {{ format(new Date(msg.date), 'HH:mm') }}
            </p>
          </div>
        </div>
      </div>
    </div>
    <div class="shrink-0 px-4 pb-4 sm:px-6">
      <UCard variant="subtle" class="mt-auto" :ui="{ header: 'flex items-center gap-1.5 text-dimmed' }">
        <template #header>
          <UIcon name="i-lucide-message-circle" class="size-5" />
          <span class="truncate text-sm">Message {{ conversation.agent.name }}</span>
        </template>
        <form @submit.prevent="onSubmit">
          <UTextarea
            v-model="message"
            color="neutral"
            variant="none"
            autoresize
            placeholder="Type your message..."
            :rows="2"
            :disabled="loading"
            class="w-full"
            :ui="{ base: 'p-0 resize-none' }"
            @keydown.enter.exact.prevent="onSubmit"
          />
          <div class="mt-2 flex justify-end gap-2">
            <UButton
              type="submit"
              color="primary"
              :loading="loading"
              label="Send"
              icon="i-lucide-send"
            />
          </div>
        </form>
      </UCard>
    </div>
  </div>

  <AgentFilesSlideover
    v-model:open="filesSlideoverOpen"
    :agent-id="conversation.id"
    :agent-name="conversation.agent.name"
    :initial-file-id="filesSlideoverInitialFile"
  />

  <AgentToolsSlideover
    v-model:open="toolsSlideoverOpen"
    :agent-id="conversation.id"
    :agent-name="conversation.agent.name"
  />
</template>
