<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { ToolFile } from '~/types'

const route = useRoute()
const router = useRouter()

const { data: tools, refresh: refreshTools } = await useFetch<ToolFile[]>('/api/tools', { default: () => [] })

const selectedTool = ref<ToolFile | null>(null)

/** Sync selected tool from route param (e.g. /tools/math). */
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
      void router.replace({ path: `/tools/${tool.id}` })
    }
  } else if (route.params.name) {
    void router.replace({ path: '/tools' })
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
    await $fetch<{ id: string; name: string }>('/api/tools', {
      method: 'POST',
      body: { name }
    })
    await refreshTools()
    addToolModalOpen.value = false
    newToolName.value = ''
    toast.add({ title: 'Tool created', description: `${name}.ts`, color: 'success' })
    await router.push(`/tools/${name}`)
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
</script>

<template>
  <UDashboardPanel
    id="tools-list"
    :default-size="25"
    :min-size="20"
    :max-size="30"
    resizable
  >
    <UDashboardNavbar title="Tools">
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
    <ToolsList v-model="selectedTool" :tools="tools" />
  </UDashboardPanel>

  <ToolsDetail v-if="selectedTool" :tool="selectedTool" @close="clearSelection" @saved="onToolSaved" />
  <div v-else class="hidden lg:flex flex-1 items-center justify-center">
    <p class="text-muted-foreground">Nothing here</p>
  </div>

  <ClientOnly>
    <USlideover v-if="isMobile" v-model:open="isToolPanelOpen">
      <template #content>
        <ToolsDetail v-if="selectedTool" :tool="selectedTool" @close="clearSelection" @saved="onToolSaved" />
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
</template>
