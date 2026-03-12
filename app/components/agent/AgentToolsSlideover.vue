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
  set: (v) => emit('update:open', v)
})

const toolsApiBase = computed(() => `/api/agents/${props.agentId}/tools`)

const tools = ref<ToolFile[]>([])
const refreshTools = async () => {
  try {
    const list = await $fetch<ToolFile[]>(toolsApiBase.value)
    tools.value = list ?? []
  } catch {
    tools.value = []
  }
}

const addToolModalOpen = ref(false)
const addGlobalToolModalOpen = ref(false)
const newToolName = ref('')
const addToolError = ref('')
const addToolLoading = ref(false)
const toast = useToast()

const globalTools = ref<ToolFile[]>([])
const selectedGlobalToolId = ref<string | null>(null)
const addGlobalToolLoading = ref(false)
const addGlobalToolError = ref('')

async function createTool() {
  const name = newToolName.value.trim().replace(/\s+/g, '-').toLowerCase()
  if (!name) {
    addToolError.value = 'Name is required'
    return
  }
  if (!/^[a-z0-9_-]+$/i.test(name)) {
    addToolError.value = 'Use only letters, numbers, hyphen or underscore'
    return
  }
  addToolError.value = ''
  addToolLoading.value = true
  try {
    await $fetch<{ id: string; name: string }>(toolsApiBase.value, {
      method: 'POST',
      body: { name }
    })
    await refreshTools()
    const created = tools.value?.find((t) => t.id === name)
    if (created) selectedTool.value = created
    addToolModalOpen.value = false
    newToolName.value = ''
    toast.add({ title: 'Tool created', description: `${name}.ts`, color: 'success' })
  } catch (e: any) {
    const msg = e?.data?.message ?? e?.message ?? 'Failed to create tool'
    addToolError.value = msg
    toast.add({ title: 'Create failed', description: msg, color: 'error' })
  } finally {
    addToolLoading.value = false
  }
}

async function linkGlobalTool() {
  const id = selectedGlobalToolId.value
  if (!id) {
    addGlobalToolError.value = 'Select a global tool'
    return
  }
  addGlobalToolError.value = ''
  addGlobalToolLoading.value = true
  try {
    await $fetch<{ id: string; name: string }>(toolsApiBase.value, {
      method: 'POST',
      body: { name: id, linkGlobal: true }
    })
    await refreshTools()
    const linked = tools.value?.find((t) => t.id === id)
    if (linked) selectedTool.value = linked
    addGlobalToolModalOpen.value = false
    selectedGlobalToolId.value = null
    toast.add({ title: 'Global tool linked', description: `${id}.ts (symlink)`, color: 'success' })
  } catch (e: any) {
    const msg = e?.data?.message ?? e?.message ?? 'Failed to link global tool'
    addGlobalToolError.value = msg
    toast.add({ title: 'Link failed', description: msg, color: 'error' })
  } finally {
    addGlobalToolLoading.value = false
  }
}

function openAddToolModal() {
  newToolName.value = ''
  addToolError.value = ''
  addToolModalOpen.value = true
}

async function openAddGlobalToolModal() {
  addGlobalToolError.value = ''
  selectedGlobalToolId.value = null
  addGlobalToolModalOpen.value = true
  try {
    const list = await $fetch<ToolFile[]>('/api/tools')
    globalTools.value = list ?? []
  } catch {
    globalTools.value = []
  }
}

const availableGlobalTools = computed(() => {
  const agentIds = new Set((tools.value ?? []).map((t) => t.id))
  return (globalTools.value ?? []).filter((t) => !agentIds.has(t.id))
})

watch(
  () => [props.open, props.agentId] as const,
  ([isOpen, id]) => {
    if (isOpen && id) void refreshTools()
  },
  { immediate: true }
)

const selectedTool = ref<ToolFile | null>(null)

async function onToolSaved() {
  await refreshTools()
  if (selectedTool.value) {
    const updated = tools.value?.find((t) => t.id === selectedTool.value?.id)
    if (updated) selectedTool.value = updated
  }
}

watch(open, (isOpen) => {
  if (!isOpen) selectedTool.value = null
})

async function removeTool(tool: ToolFile) {
  try {
    await $fetch(`${toolsApiBase.value}/${tool.id}`, { method: 'DELETE' })
    if (selectedTool.value?.id === tool.id) selectedTool.value = null
    await refreshTools()
    toast.add({
      title: tool.symlink ? 'Unlinked' : 'Tool deleted',
      description: `${tool.name}.ts`,
      color: 'success'
    })
  } catch (e: any) {
    const msg = e?.data?.message ?? e?.message ?? 'Failed to remove'
    toast.add({ title: 'Remove failed', description: msg, color: 'error' })
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="`${agentName} – Tools`"
    :ui="{
      content: 'w-full max-w-full md:max-w-full lg:max-w-6xl inset-y-0 right-0 h-full min-h-screen'
    }"
  >
    <template #content>
      <div class="flex h-full flex-col min-h-0">
        <div class="grid flex-1 min-h-0" style="grid-template-columns: minmax(0, 1fr) minmax(0, 2fr)">
          <div class="flex flex-col min-h-0 border-r border-default">
            <div class="shrink-0 space-y-2 border-b border-default p-2">
              <p class="text-sm text-dimmed">Edit tool files for this agent.</p>
              <div class="flex gap-2">
                <UButton
                  icon="i-lucide-plus"
                  color="primary"
                  variant="outline"
                  size="sm"
                  label="New tool"
                  class="flex-1"
                  @click="openAddToolModal"
                />
                <UButton
                  icon="i-lucide-link"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  label="Add global"
                  class="flex-1"
                  @click="openAddGlobalToolModal"
                />
              </div>
            </div>
            <div class="flex-1 overflow-y-auto">
              <ToolsList
              v-model="selectedTool"
              :tools="tools ?? []"
              removable
              :on-remove="removeTool"
            />
            </div>
          </div>
          <div class="flex flex-col min-h-0">
            <ToolsDetail
              v-if="selectedTool"
              :tool="selectedTool"
              :tools-api-base="toolsApiBase"
              @close="selectedTool = null"
              @saved="onToolSaved"
            />
            <div v-else class="flex flex-1 items-center justify-center p-6 text-dimmed text-sm">
              Select a tool to edit
            </div>
          </div>
        </div>
      </div>
    </template>
  </USlideover>

  <UModal v-model:open="addToolModalOpen" title="Add tool">
    <template #body>
      <div class="space-y-4 p-4">
        <div>
          <label class="mb-1.5 block text-sm font-medium text-highlighted">Tool name</label>
          <UInput
            v-model="newToolName"
            placeholder="e.g. my-tool"
            class="font-mono"
            :disabled="addToolLoading"
            @keydown.enter="createTool"
          />
          <p class="mt-1 text-xs text-dimmed">Letters, numbers, hyphen or underscore only. Must be unique.</p>
          <p v-if="addToolError" class="mt-1 text-sm text-error">{{ addToolError }}</p>
        </div>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" :disabled="addToolLoading" @click="addToolModalOpen = false" />
          <UButton icon="i-lucide-plus" label="Create" :loading="addToolLoading" @click="createTool" />
        </div>
      </div>
    </template>
  </UModal>

  <UModal v-model:open="addGlobalToolModalOpen" title="Add global tool">
    <template #body>
      <div class="space-y-4 p-4">
        <p class="text-sm text-dimmed">Link a tool from the global list. It will be added as a symlink (read-only here).</p>
        <div v-if="availableGlobalTools.length === 0" class="rounded-lg border border-default bg-elevated/50 p-4 text-sm text-dimmed">
          No global tools available to link, or all are already added.
        </div>
        <div v-else>
          <label class="mb-1.5 block text-sm font-medium text-highlighted">Global tool</label>
          <USelect
            v-model="selectedGlobalToolId"
            :items="availableGlobalTools.map((t) => ({ label: t.name, value: t.id }))"
            placeholder="Choose a tool"
            :disabled="addGlobalToolLoading"
          />
          <p v-if="addGlobalToolError" class="mt-1 text-sm text-error">{{ addGlobalToolError }}</p>
        </div>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" :disabled="addGlobalToolLoading" @click="addGlobalToolModalOpen = false" />
          <UButton icon="i-lucide-link" label="Link" :loading="addGlobalToolLoading" :disabled="!selectedGlobalToolId" @click="linkGlobalTool" />
        </div>
      </div>
    </template>
  </UModal>
</template>
