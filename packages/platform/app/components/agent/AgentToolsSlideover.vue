<script setup lang="ts">
type AgentToolEntry = {
  id: string
  name: string
  linked: boolean
}

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
  set: (v) => emit('update:open', v)
})

const toolsApiBase = computed(() => `/api/agents/${props.agentId}/tools`)
const tools = ref<AgentToolEntry[]>([])
const loading = ref(false)
const toggling = ref<Set<string>>(new Set())
const toast = useToast()

async function refreshTools() {
  loading.value = true
  try {
    const list = await $fetch<AgentToolEntry[]>(toolsApiBase.value)
    tools.value = list ?? []
  } catch {
    tools.value = []
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.open, props.agentId] as const,
  ([isOpen, id]) => {
    if (isOpen && id) void refreshTools()
  },
  { immediate: true }
)

async function toggleTool(tool: AgentToolEntry) {
  if (toggling.value.has(tool.id)) return

  toggling.value = new Set([...toggling.value, tool.id])
  try {
    if (tool.linked) {
      await $fetch(`${toolsApiBase.value}/${tool.id}`, { method: 'DELETE' })
      toast.add({
        title: 'Tool disconnected',
        description: `${tool.name} removed from ${props.agentName}`,
        color: 'success',
      })
    } else {
      await $fetch(toolsApiBase.value, {
        method: 'POST',
        body: { toolName: tool.id },
      })
      toast.add({
        title: 'Tool connected',
        description: `${tool.name} added to ${props.agentName}`,
        color: 'success',
      })
    }
    await refreshTools()
  } catch (e: any) {
    const msg = e?.data?.message ?? e?.message ?? 'Failed to update tool'
    toast.add({ title: 'Error', description: msg, color: 'error' })
  } finally {
    const next = new Set(toggling.value)
    next.delete(tool.id)
    toggling.value = next
  }
}

const linkedCount = computed(() => tools.value.filter((t) => t.linked).length)
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="`${agentName} – Tools`"
    :ui="{
      content: 'w-full max-w-md inset-y-0 right-0 h-full min-h-screen'
    }"
  >
    <template #content>
      <div class="flex h-full flex-col min-h-0 bg-background">
        <div class="shrink-0 space-y-2 border-b border-default p-4">
          <div class="flex items-center justify-between">
            <div>
              <span class="font-semibold text-highlighted">Connect Tools</span>
              <UBadge v-if="linkedCount > 0" :label="linkedCount" variant="subtle" class="ml-2" />
            </div>
            <UButton icon="i-lucide-x" color="neutral" variant="ghost" class="-my-1.5 -mr-1.5" @click="open = false" />
          </div>
          <p class="text-sm text-dimmed">Toggle global tools on or off for this agent.</p>
          <UButton
            icon="i-lucide-external-link"
            color="neutral"
            variant="outline"
            size="sm"
            label="Manage Global Tools"
            to="/tools"
            target="_blank"
            block
          />
        </div>

        <div v-if="loading && tools.length === 0" class="flex flex-1 items-center justify-center">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-dimmed" />
        </div>

        <div v-else-if="tools.length === 0" class="flex flex-1 items-center justify-center p-6">
          <div class="text-center">
            <UIcon name="i-lucide-wrench" class="size-12 text-dimmed mb-3" />
            <p class="text-sm text-dimmed">No global tools available.</p>
            <p class="text-xs text-dimmed mt-1">Create tools from the global Tools page first.</p>
          </div>
        </div>

        <div v-else class="flex-1 overflow-y-auto divide-y divide-default">
          <div
            v-for="tool in tools"
            :key="tool.id"
            class="flex items-center justify-between gap-3 px-4 py-3 transition-colors"
            :class="tool.linked ? 'bg-primary/5' : 'hover:bg-elevated/50'"
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <UIcon
                  :name="tool.linked ? 'i-lucide-plug' : 'i-lucide-wrench'"
                  class="size-4 shrink-0"
                  :class="tool.linked ? 'text-primary' : 'text-dimmed'"
                />
                <span class="text-sm font-medium" :class="tool.linked ? 'text-highlighted' : 'text-toned'">
                  {{ tool.name }}
                </span>
              </div>
              <p class="text-xs text-dimmed mt-0.5 ml-6">{{ tool.id }}.ts</p>
            </div>
            <USwitch
              :model-value="tool.linked"
              :disabled="toggling.has(tool.id)"
              :loading="toggling.has(tool.id)"
              @update:model-value="toggleTool(tool)"
            />
          </div>
        </div>
      </div>
    </template>
  </USlideover>
</template>
