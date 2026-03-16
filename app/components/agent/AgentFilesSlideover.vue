<script setup lang="ts">
import type { ToolFile } from '~/types'

const props = defineProps<{
  agentId: string
  agentName: string
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const open = computed({
  get: () => props.open,
  set: v => emit('update:open', v)
})

const filesApiBase = computed(() => `/api/agents/${props.agentId}/files`)

const agentFiles = ref<ToolFile[]>([])
const refreshFiles = async () => {
  try {
    const list = await $fetch<ToolFile[]>(filesApiBase.value)
    agentFiles.value = list ?? []
  } catch {
    agentFiles.value = []
  }
}

watch(
  () => [props.open, props.agentId] as const,
  ([isOpen, id]) => {
    if (isOpen && id) void refreshFiles()
  },
  { immediate: true }
)

const selectedFile = ref<ToolFile | null>(null)

async function onFileSaved() {
  await refreshFiles()
  if (selectedFile.value) {
    const updated = agentFiles.value?.find(t => t.id === selectedFile.value?.id)
    if (updated) selectedFile.value = updated
  }
}

watch(open, (isOpen) => {
  if (!isOpen) selectedFile.value = null
})
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="`${agentName} – Agent System`"
    :ui="{
      content: 'w-full max-w-full md:max-w-full lg:max-w-6xl inset-y-0 right-0 h-full min-h-screen'
    }"
  >
    <template #content>
      <div class="flex h-full flex-col min-h-0 bg-background">
        <div class="grid flex-1 min-h-0" style="grid-template-columns: minmax(0, 1fr) minmax(0, 2fr)">
          <div class="flex flex-col min-h-0 border-r border-default">
            <div class="shrink-0 space-y-2 border-b border-default p-4">
              <div class="flex items-center justify-between">
                <span class="font-semibold text-highlighted">Manage Agent System</span>
                <UButton
                  icon="i-lucide-x"
                  color="neutral"
                  variant="ghost"
                  class="-my-1.5 -mr-1.5"
                  @click="open = false"
                />
              </div>
              <p class="text-sm text-dimmed">
                Edit system files for this agent.
              </p>
            </div>
            <div class="flex-1 overflow-y-auto">
              <ToolsList
                v-model="selectedFile"
                :tools="agentFiles ?? []"
                :removable="false"
                icon="i-lucide-code"
              />
            </div>
          </div>
          <div class="flex flex-col min-h-0">
            <ToolsDetail
              v-if="selectedFile"
              :tool="selectedFile"
              :tools-api-base="filesApiBase"
              @close="selectedFile = null"
              @saved="onFileSaved"
              @copied="onFileSaved"
            />
            <div v-else class="flex flex-1 items-center justify-center p-6 text-dimmed text-sm">
              Select a file to edit
            </div>
          </div>
        </div>
      </div>
    </template>
  </USlideover>
</template>
