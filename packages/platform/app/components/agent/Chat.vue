<script setup lang="ts">
import { format } from 'date-fns'
import type { AgentConversation, ChatApprovalAction, ChatMessage, ChatTimelineItem } from '~/types'

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
  approvalDecision: [messageId: string, decision: 'approve' | 'edit' | 'comment' | 'reject', payload?: Array<{ name: string, args: Record<string, unknown> }> | string]
  newChat: []
  deleteAgent: []
}>()

const message = ref('')
const localSending = ref(false)
const filesSlideoverOpen = ref(false)
const toolsSlideoverOpen = ref(false)

const toolCallOpen = ref<Record<string, boolean>>({})
const approvalEditModalOpen = ref(false)
const approvalEditMessageId = ref<string | null>(null)
const approvalEditActionCount = ref(0)
const approvalEditActionsText = ref('')
const approvalEditError = ref('')
const approvalCommentModalOpen = ref(false)
const approvalCommentMessageId = ref<string | null>(null)
const approvalCommentText = ref('')

const loading = computed(() => localSending.value || !!props.sendLoading)
const promptSubmitDisabled = computed(() => loading.value || !message.value.trim())
const selectedModel = ref('qwen3.5:9b')
const modelItems = [
  {
    label: 'qwen3.5:9b',
    value: 'qwen3.5:9b',
    icon: 'i-lucide-cpu'
  }
]

function shouldShowWorkingState(message: ChatMessage) {
  return message.role === 'agent'
    && message.streamState === 'working'
    && !message.content.trim()
    && !message.thinking?.trim()
}

function hasTimeline(message: ChatMessage) {
  return message.role === 'agent' && !!message.timeline?.length
}

function hasPendingApproval(message: ChatMessage) {
  return message.role === 'agent' && !!message.pendingApproval
}

function hasThinking(message: ChatMessage) {
  return message.role === 'agent' && !!message.thinking?.trim()
}

function getToolCallKey(messageId: string, itemValue: string) {
  return `${messageId}:${itemValue}`
}

function isToolCallOpen(messageId: string, itemValue: string) {
  return !!toolCallOpen.value[getToolCallKey(messageId, itemValue)]
}

function setToolCallOpen(messageId: string, itemValue: string, open: boolean) {
  const key = getToolCallKey(messageId, itemValue)
  toolCallOpen.value = {
    ...toolCallOpen.value,
    [key]: open
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

function getToolCallLabel(item: ChatTimelineItem) {
  if (item.toolState === 'done') {
    return `${item.title} executed`
  }

  if (item.toolState === 'error') {
    return `${item.title} failed`
  }

  return `Executing ${item.title}`
}

function getToolCallSuffix(item: ChatTimelineItem) {
  return formatDuration(item.durationMs) ?? undefined
}

function getToolCallIcon(_item: ChatTimelineItem) {
  if (_item.toolState === 'error') return 'i-lucide-circle-alert'
  if (_item.toolState === 'done') return 'i-lucide-circle-check'
  return 'i-lucide-wrench'
}

function isToolCallStreaming(item: ChatTimelineItem) {
  return item.toolState === 'working'
}

function isReasoningStreaming(message: ChatMessage) {
  return message.thinkingState === 'working'
}

function getReasoningDuration(message: ChatMessage) {
  if (message.thinkingDurationMs == null) return undefined
  return Math.ceil(message.thinkingDurationMs / 1000)
}

function shouldRenderBubble(message: ChatMessage) {
  return message.role === 'user'
}

function shouldRenderAgentContent(message: ChatMessage) {
  return message.role === 'agent'
    && !hasPendingApproval(message)
    && (!!message.content.trim() || shouldShowWorkingState(message) || !hasTimeline(message))
}

function shouldShowAgentTimestamp(message: ChatMessage) {
  return !!message.content.trim() && !hasThinking(message) && !shouldShowWorkingState(message)
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

function getApprovalStatus(message: ChatMessage) {
  const state = message.pendingApproval?.state
  if (state === 'approved') return 'Approved'
  if (state === 'edited') return 'Edited'
  if (state === 'commented') return 'Comment sent'
  if (state === 'rejected') return 'Rejected'
  return 'Awaiting approval'
}

function getApprovalStatusIcon(message: ChatMessage) {
  const state = message.pendingApproval?.state
  if (state === 'approved') return 'i-lucide-circle-check'
  if (state === 'edited') return 'i-lucide-pencil'
  if (state === 'commented') return 'i-lucide-message-square'
  if (state === 'rejected') return 'i-lucide-circle-x'
  return 'i-lucide-shield-alert'
}

function getApprovalStatusClass(message: ChatMessage) {
  const state = message.pendingApproval?.state
  if (state === 'approved') return 'text-success'
  if (state === 'edited') return 'text-info'
  if (state === 'commented') return 'text-info'
  if (state === 'rejected') return 'text-error'
  return 'text-warning'
}

function getApprovalActionDescription(action: ChatApprovalAction) {
  if (action.description?.trim()) return action.description
  return JSON.stringify(action.args, null, 2)
}

function isApprovalDecisionAllowed(message: ChatMessage, decision: 'approve' | 'edit' | 'reject') {
  const configs = message.pendingApproval?.reviewConfigs ?? []
  if (!configs.length) return true
  return configs.every(config => config.allowedDecisions.includes(decision))
}

function canRespondToApproval(message: ChatMessage, decision: 'approve' | 'reject') {
  return message.pendingApproval?.state === 'pending'
    && !loading.value
    && isApprovalDecisionAllowed(message, decision)
}

function canEditApproval(message: ChatMessage) {
  return message.pendingApproval?.state === 'pending'
    && !loading.value
    && isApprovalDecisionAllowed(message, 'edit')
}

function canCommentOnApproval(message: ChatMessage) {
  return message.pendingApproval?.state === 'pending'
    && !loading.value
    && isApprovalDecisionAllowed(message, 'reject')
}

function getEditableApprovalActions(message: ChatMessage) {
  return (message.pendingApproval?.actionRequests ?? []).map(action => ({
    name: action.name,
    args: action.args,
  }))
}

function openApprovalEditDialog(message: ChatMessage) {
  if (!canEditApproval(message)) return

  const actions = getEditableApprovalActions(message)
  approvalEditMessageId.value = message.id
  approvalEditActionCount.value = actions.length
  approvalEditActionsText.value = JSON.stringify(actions.length === 1 ? actions[0] : actions, null, 2)
  approvalEditError.value = ''
  approvalEditModalOpen.value = true
}

function parseEditedApprovalActions() {
  approvalEditError.value = ''

  let parsed: unknown
  try {
    parsed = JSON.parse(approvalEditActionsText.value)
  } catch {
    approvalEditError.value = 'Invalid JSON.'
    return null
  }

  const items = Array.isArray(parsed) ? parsed : [parsed]
  if (items.length !== approvalEditActionCount.value) {
    approvalEditError.value = `Expected ${approvalEditActionCount.value} edited action${approvalEditActionCount.value === 1 ? '' : 's'}.`
    return null
  }

  const editedActions = items.map((item) => {
    const action = item && typeof item === 'object' ? item as Record<string, unknown> : null
    const args = action?.args

    if (!action || typeof action.name !== 'string' || !action.name.trim() || !args || typeof args !== 'object' || Array.isArray(args)) {
      approvalEditError.value = 'Each edited action must include a name and object args.'
      return null
    }

    return {
      name: action.name.trim(),
      args: args as Record<string, unknown>,
    }
  })

  if (editedActions.some(action => action == null)) return null
  return editedActions as Array<{ name: string, args: Record<string, unknown> }>
}

function submitApprovalEdit() {
  if (!approvalEditMessageId.value || !approvalEditActionsText.value.trim() || loading.value) return

  const editedActions = parseEditedApprovalActions()
  if (!editedActions) return

  emit('approvalDecision', approvalEditMessageId.value, 'edit', editedActions)
  approvalEditModalOpen.value = false
  approvalEditMessageId.value = null
  approvalEditActionCount.value = 0
  approvalEditActionsText.value = ''
  approvalEditError.value = ''
}

function openApprovalCommentDialog(message: ChatMessage) {
  if (!canCommentOnApproval(message)) return

  approvalCommentMessageId.value = message.id
  approvalCommentText.value = ''
  approvalCommentModalOpen.value = true
}

function submitApprovalComment() {
  const text = approvalCommentText.value.trim()
  if (!approvalCommentMessageId.value || !text || loading.value) return

  emit('approvalDecision', approvalCommentMessageId.value, 'comment', text)
  approvalCommentModalOpen.value = false
  approvalCommentMessageId.value = null
  approvalCommentText.value = ''
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
        <UTooltip text="Connect tools">
          <UButton
            icon="i-lucide-plug"
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
            <UChatTool
              v-for="item in (msg.timeline || [])"
              :key="`${msg.id}-${item.value}`"
              :open="isToolCallOpen(msg.id, String(item.value))"
              :text="getToolCallLabel(item)"
              :suffix="getToolCallSuffix(item)"
              :icon="getToolCallIcon(item)"
              :loading="isToolCallStreaming(item)"
              :streaming="isToolCallStreaming(item)"
              chevron="trailing"
              @update:open="setToolCallOpen(msg.id, String(item.value), $event)"
            >
              {{ item.description }}
            </UChatTool>
          </div>
          <div
            v-if="hasPendingApproval(msg)"
            class="mb-2 w-full max-w-xl rounded-lg border border-default bg-elevated p-3 shadow-sm"
          >
            <div class="flex items-start gap-3">
              <UIcon
                :name="getApprovalStatusIcon(msg)"
                class="mt-0.5 size-4 shrink-0"
                :class="getApprovalStatusClass(msg)"
              />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-highlighted">
                  {{ getApprovalStatus(msg) }}
                </p>
                <div class="mt-2 space-y-2">
                  <div
                    v-for="(action, index) in (msg.pendingApproval?.actionRequests || [])"
                    :key="`${msg.id}-approval-${index}`"
                    class="rounded-md border border-default bg-default/50 p-2"
                  >
                    <p class="truncate text-xs font-medium text-muted">
                      {{ action.name }}
                    </p>
                    <pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-default">{{ getApprovalActionDescription(action) }}</pre>
                  </div>
                </div>
                <div v-if="msg.pendingApproval?.state === 'pending'" class="mt-3 flex flex-wrap gap-2">
                  <UButton
                    label="Approve"
                    icon="i-lucide-check"
                    color="success"
                    size="xs"
                    :disabled="!canRespondToApproval(msg, 'approve')"
                    @click="emit('approvalDecision', msg.id, 'approve')"
                  />
                  <UButton
                    label="Edit"
                    icon="i-lucide-pencil"
                    color="info"
                    variant="soft"
                    size="xs"
                    :disabled="!canEditApproval(msg)"
                    @click="openApprovalEditDialog(msg)"
                  />
                  <UButton
                    label="Comment"
                    icon="i-lucide-message-square"
                    color="info"
                    variant="soft"
                    size="xs"
                    :disabled="!canCommentOnApproval(msg)"
                    @click="openApprovalCommentDialog(msg)"
                  />
                  <UButton
                    label="Reject"
                    icon="i-lucide-x"
                    color="error"
                    variant="soft"
                    size="xs"
                    :disabled="!canRespondToApproval(msg, 'reject')"
                    @click="emit('approvalDecision', msg.id, 'reject')"
                  />
                </div>
              </div>
            </div>
            <p class="mt-2 text-xs text-dimmed">
              {{ format(new Date(msg.date), 'HH:mm') }}
            </p>
          </div>
          <div v-if="shouldRenderAgentContent(msg)" class="px-1 py-0.5">
            <UChatReasoning
              v-if="hasThinking(msg)"
              class="mb-3"
              :text="msg.thinking"
              :streaming="isReasoningStreaming(msg)"
              :duration="getReasoningDuration(msg)"
              icon="i-lucide-brain"
            />
            <AgentChatMarkdown v-if="msg.content" :content="msg.content" />
            <div v-else-if="shouldShowWorkingState(msg)" class="space-y-2 py-0.5">
              <USkeleton class="h-3.5 w-20 rounded-full bg-primary/25 ring-1 ring-primary/10" />
              <USkeleton class="h-3.5 w-52 rounded-full bg-primary/20 ring-1 ring-primary/10" />
              <USkeleton class="h-3.5 w-36 rounded-full bg-primary/15 ring-1 ring-primary/10" />
            </div>
            <p v-if="shouldShowAgentTimestamp(msg)" class="mt-1 text-xs text-dimmed">
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
      <UChatPrompt
        v-model="message"
        variant="subtle"
        placeholder="Type your message..."
        :rows="2"
        :disabled="loading"
        class="mt-auto"
        @submit="onSubmit"
      >
        <UChatPromptSubmit
          color="neutral"
          :loading="loading"
          :disabled="promptSubmitDisabled"
        />

        <template #footer>
          <USelect
            v-model="selectedModel"
            :items="modelItems"
            icon="i-lucide-cpu"
            placeholder="Select a model"
            variant="ghost"
            disabled
          />
        </template>
      </UChatPrompt>
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
        <UTooltip text="Connect tools">
          <UButton
            icon="i-lucide-plug"
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
            <UChatTool
              v-for="item in (msg.timeline || [])"
              :key="`${msg.id}-${item.value}-mobile`"
              :open="isToolCallOpen(msg.id, String(item.value))"
              :text="getToolCallLabel(item)"
              :suffix="getToolCallSuffix(item)"
              :icon="getToolCallIcon(item)"
              :loading="isToolCallStreaming(item)"
              :streaming="isToolCallStreaming(item)"
              chevron="trailing"
              @update:open="setToolCallOpen(msg.id, String(item.value), $event)"
            >
              {{ item.description }}
            </UChatTool>
          </div>
          <div
            v-if="hasPendingApproval(msg)"
            class="mb-2 w-full max-w-xl rounded-lg border border-default bg-elevated p-3 shadow-sm"
          >
            <div class="flex items-start gap-3">
              <UIcon
                :name="getApprovalStatusIcon(msg)"
                class="mt-0.5 size-4 shrink-0"
                :class="getApprovalStatusClass(msg)"
              />
              <div class="min-w-0 flex-1">
                <p class="text-sm font-medium text-highlighted">
                  {{ getApprovalStatus(msg) }}
                </p>
                <div class="mt-2 space-y-2">
                  <div
                    v-for="(action, index) in (msg.pendingApproval?.actionRequests || [])"
                    :key="`${msg.id}-approval-${index}-mobile`"
                    class="rounded-md border border-default bg-default/50 p-2"
                  >
                    <p class="truncate text-xs font-medium text-muted">
                      {{ action.name }}
                    </p>
                    <pre class="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-default">{{ getApprovalActionDescription(action) }}</pre>
                  </div>
                </div>
                <div v-if="msg.pendingApproval?.state === 'pending'" class="mt-3 flex flex-wrap gap-2">
                  <UButton
                    label="Approve"
                    icon="i-lucide-check"
                    color="success"
                    size="xs"
                    :disabled="!canRespondToApproval(msg, 'approve')"
                    @click="emit('approvalDecision', msg.id, 'approve')"
                  />
                  <UButton
                    label="Edit"
                    icon="i-lucide-pencil"
                    color="info"
                    variant="soft"
                    size="xs"
                    :disabled="!canEditApproval(msg)"
                    @click="openApprovalEditDialog(msg)"
                  />
                  <UButton
                    label="Comment"
                    icon="i-lucide-message-square"
                    color="info"
                    variant="soft"
                    size="xs"
                    :disabled="!canCommentOnApproval(msg)"
                    @click="openApprovalCommentDialog(msg)"
                  />
                  <UButton
                    label="Reject"
                    icon="i-lucide-x"
                    color="error"
                    variant="soft"
                    size="xs"
                    :disabled="!canRespondToApproval(msg, 'reject')"
                    @click="emit('approvalDecision', msg.id, 'reject')"
                  />
                </div>
              </div>
            </div>
            <p class="mt-2 text-xs text-dimmed">
              {{ format(new Date(msg.date), 'HH:mm') }}
            </p>
          </div>
          <div v-if="shouldRenderAgentContent(msg)" class="px-1 py-0.5">
            <UChatReasoning
              v-if="hasThinking(msg)"
              class="mb-3"
              :text="msg.thinking"
              :streaming="isReasoningStreaming(msg)"
              :duration="getReasoningDuration(msg)"
              icon="i-lucide-brain"
            />
            <AgentChatMarkdown v-if="msg.content" :content="msg.content" />
            <div v-else-if="shouldShowWorkingState(msg)" class="space-y-2 py-0.5">
              <USkeleton class="h-3.5 w-20 rounded-full bg-primary/25 ring-1 ring-primary/10" />
              <USkeleton class="h-3.5 w-52 rounded-full bg-primary/20 ring-1 ring-primary/10" />
              <USkeleton class="h-3.5 w-36 rounded-full bg-primary/15 ring-1 ring-primary/10" />
            </div>
            <p v-if="shouldShowAgentTimestamp(msg)" class="mt-1 text-xs text-dimmed">
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
      <UChatPrompt
        v-model="message"
        variant="subtle"
        placeholder="Type your message..."
        :rows="2"
        :disabled="loading"
        class="mt-auto"
        @submit="onSubmit"
      >
        <UChatPromptSubmit
          color="neutral"
          :loading="loading"
          :disabled="promptSubmitDisabled"
        />

        <template #footer>
          <USelect
            v-model="selectedModel"
            :items="modelItems"
            icon="i-lucide-cpu"
            placeholder="Select a model"
            variant="ghost"
            disabled
          />
        </template>
      </UChatPrompt>
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


  <UModal v-model:open="approvalEditModalOpen" title="Edit tool request">
    <template #body>
      <div class="space-y-4 p-4">
        <UTextarea
          v-model="approvalEditActionsText"
          :rows="10"
          autoresize
          autofocus
          placeholder="{ &quot;name&quot;: &quot;shell_exec&quot;, &quot;args&quot;: { &quot;command&quot;: &quot;pwd&quot; } }"
          :disabled="loading"
          class="font-mono text-xs"
          @keydown.meta.enter.prevent="submitApprovalEdit"
          @keydown.ctrl.enter.prevent="submitApprovalEdit"
        />
        <p v-if="approvalEditError" class="text-sm text-error">
          {{ approvalEditError }}
        </p>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            :disabled="loading"
            @click="approvalEditModalOpen = false"
          />
          <UButton
            label="Apply edit"
            icon="i-lucide-pencil"
            color="info"
            :disabled="!approvalEditActionsText.trim() || loading"
            @click="submitApprovalEdit"
          />
        </div>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="approvalCommentModalOpen" title="Comment on tool request">
    <template #body>
      <div class="space-y-4 p-4">
        <UTextarea
          v-model="approvalCommentText"
          :rows="5"
          autoresize
          autofocus
          placeholder="Tell the agent what to change or reconsider..."
          :disabled="loading"
          @keydown.meta.enter.prevent="submitApprovalComment"
          @keydown.ctrl.enter.prevent="submitApprovalComment"
        />
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            :disabled="loading"
            @click="approvalCommentModalOpen = false"
          />
          <UButton
            label="Send comment"
            icon="i-lucide-send"
            color="info"
            :disabled="!approvalCommentText.trim() || loading"
            @click="submitApprovalComment"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
