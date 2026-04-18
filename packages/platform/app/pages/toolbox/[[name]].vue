<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { ToolFile } from '~/types'

const route = useRoute()
const router = useRouter()

const { data: tools, refresh: refreshTools } = await useFetch<ToolFile[]>('/api/toolbox', { default: () => [] })

const selectedTool = ref<ToolFile | null>(null)

/** Sync selected tool from route param (e.g. /toolbox/math). */
function syncSelectionFromRoute() {
  const name = route.params.name
  if (typeof name !== 'string' || !name) {
    selectedTool.value = null
    return
  }
  const tool = tools.value?.find((t) => t.id === name)
  selectedTool.value = tool ?? null
}

watch(
  () => [route.params.name, tools.value] as const,
  () => syncSelectionFromRoute(),
  { immediate: true }
)

/** When user picks a tool in the list or closes detail, update URL. */
watch(selectedTool, (tool) => {
  if (tool) {
    if (route.params.name !== tool.id) {
      void router.replace({ path: `/toolbox/${tool.id}` })
    }
  } else if (route.params.name) {
    void router.replace({ path: '/toolbox' })
  }
}, { flush: 'post' })

async function onToolSaved() {
  await refreshTools()
  if (selectedTool.value) {
    const updated = tools.value?.find((t) => t.id === selectedTool.value?.id)
    if (updated) selectedTool.value = updated
  }
}

function clearSelection() {
  selectedTool.value = null
}

const isToolPanelOpen = computed({
  get() {
    return !!selectedTool.value
  },
  set(value: boolean) {
    if (!value) clearSelection()
  }
})

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg')

const addToolModalOpen = ref(false)
const newToolName = ref('')
const addToolError = ref('')
const addToolLoading = ref(false)
const toast = useToast()

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
    await $fetch<{ id: string; name: string }>('/api/toolbox', {
      method: 'POST',
      body: { name }
    })
    await refreshTools()
    addToolModalOpen.value = false
    newToolName.value = ''
    toast.add({ title: 'Tool created', description: `${name}.ts`, color: 'success' })
    await router.push(`/toolbox/${name}`)
  } catch (e: any) {
    const msg = e?.data?.message ?? e?.message ?? 'Failed to create tool'
    addToolError.value = msg
    toast.add({ title: 'Create failed', description: msg, color: 'error' })
  } finally {
    addToolLoading.value = false
  }
}

function openAddToolModal() {
  newToolName.value = ''
  addToolError.value = ''
  addToolModalOpen.value = true
}

const removeModalOpen = ref(false)
const toolToRemove = ref<ToolFile | null>(null)
const removeDepsStatus = ref<'checking' | 'found' | 'safe'>('checking')
const removeDeps = ref<{ agentId: string; agentName: string }[]>([])
const removeLoading = ref(false)

async function checkDeps(tool: ToolFile) {
  removeDepsStatus.value = 'checking'
  try {
    const res = await $fetch<{ deps: { agentId: string; agentName: string }[] }>(`/api/toolbox/${tool.id}/deps`)
    if (res.deps.length > 0) {
      removeDeps.value = res.deps
      removeDepsStatus.value = 'found'
    } else {
      removeDeps.value = []
      removeDepsStatus.value = 'safe'
    }
  } catch (e: any) {
    toast.add({ title: 'Dependency check failed', description: e.message, color: 'error' })
    removeModalOpen.value = false
  }
}

function openRemoveModal(tool: ToolFile) {
  toolToRemove.value = tool
  removeModalOpen.value = true
  void checkDeps(tool)
}

function refreshDeps() {
  if (toolToRemove.value) {
    void checkDeps(toolToRemove.value)
  }
}

async function confirmRemove() {
  if (!toolToRemove.value || removeDepsStatus.value !== 'safe') return
  removeLoading.value = true
  try {
    await $fetch(`/api/toolbox/${toolToRemove.value.id}`, { method: 'DELETE' })
    toast.add({ title: 'Tool deleted', description: `${toolToRemove.value.name}.ts removed`, color: 'success' })
    await refreshTools()
    if (selectedTool.value?.id === toolToRemove.value.id) {
      void router.replace('/toolbox')
      selectedTool.value = null
    }
    removeModalOpen.value = false
  } catch (e: any) {
    toast.add({ title: 'Delete failed', description: e.message, color: 'error' })
  } finally {
    removeLoading.value = false
  }
}
</script>

<template>
  <UDashboardPanel
    id="toolbox-list"
    :default-size="25"
    :min-size="20"
    :max-size="30"
    resizable
  >
    <UDashboardNavbar title="Toolbox">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <div class="flex items-center gap-2">
          <UButton
            icon="i-lucide-plus"
            color="primary"
            variant="outline"
            size="sm"
            label="Add tool"
            @click="openAddToolModal"
          />
          <UBadge :label="tools.length" variant="subtle" />
        </div>
      </template>
    </UDashboardNavbar>
    <ToolboxList v-model="selectedTool" :tools="tools" removable :on-remove="openRemoveModal" />
  </UDashboardPanel>

  <ToolboxDetail v-if="selectedTool" :tool="selectedTool" @close="clearSelection" @saved="onToolSaved" />
  <div v-else class="hidden lg:flex flex-1 items-center justify-center">
    <p class="text-muted-foreground">Nothing here</p>
  </div>

  <ClientOnly>
    <USlideover v-if="isMobile" v-model:open="isToolPanelOpen">
      <template #content>
        <ToolboxDetail v-if="selectedTool" :tool="selectedTool" @close="clearSelection" @saved="onToolSaved" />
      </template>
    </USlideover>
  </ClientOnly>

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

  <UModal v-model:open="removeModalOpen" :title="`Delete ${toolToRemove?.name}?`">
    <template #body>
      <div v-if="removeDepsStatus === 'checking'" class="flex items-center justify-center py-8">
        <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-dimmed" />
        <span class="ml-2 text-sm text-dimmed">Checking for agent dependencies...</span>
      </div>

      <div v-else-if="removeDepsStatus === 'found'" class="space-y-4 p-4 text-sm">
        <div class="rounded-lg bg-warning/10 p-4 text-warning border border-warning/20 flex flex-col gap-2">
          <div class="flex items-center gap-2 font-medium">
            <UIcon name="i-lucide-alert-triangle" class="size-5 shrink-0" />
            Cannot Delete Tool
          </div>
          <p>
            This tool is currently linked to the following agent(s). You must unlink it from these agents before you can delete it globally.
          </p>
        </div>
        
        <ul class="space-y-2 border border-default rounded-lg divide-y divide-default">
          <li v-for="dep in removeDeps" :key="dep.agentId" class="p-3 flex items-center justify-between">
            <div>
              <p class="font-medium text-highlighted">{{ dep.agentName }}</p>
              <p class="text-xs text-dimmed">Agent ID: {{ dep.agentId }}</p>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              size="xs"
              label="Open Agent"
              icon="i-lucide-external-link"
              :to="`/agents/${dep.agentId}`"
              target="_blank"
            />
          </li>
        </ul>

        <div class="flex justify-between items-center pt-2">
          <UButton color="neutral" variant="ghost" icon="i-lucide-refresh-cw" label="Refresh" @click="refreshDeps" />
          <UButton color="neutral" variant="outline" label="Close" @click="removeModalOpen = false" />
        </div>
      </div>

      <div v-else-if="removeDepsStatus === 'safe'" class="space-y-4 p-4">
        <p class="text-sm">
          Are you sure you want to permanently delete <span class="font-medium text-highlighted">{{ toolToRemove?.name }}.ts</span>?
        </p>
        <p class="text-xs text-dimmed">This file will be removed from disk. This action cannot be undone.</p>
        <div class="flex justify-end gap-2 pt-2">
          <UButton color="neutral" variant="ghost" label="Cancel" :disabled="removeLoading" @click="removeModalOpen = false" />
          <UButton color="error" icon="i-lucide-trash-2" label="Delete" :loading="removeLoading" @click="confirmRemove" />
        </div>
      </div>
    </template>
  </UModal>
</template>
