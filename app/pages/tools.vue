<script setup lang="ts">
import { computed, ref } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { ToolFile } from '~/types'

const { data: tools, refresh: refreshTools } = await useFetch<ToolFile[]>('/api/tools', { default: () => [] })

const selectedTool = ref<ToolFile | null>(null)

async function onToolSaved() {
  await refreshTools()
  if (selectedTool.value) {
    const updated = tools.value?.find((t) => t.id === selectedTool.value?.id)
    if (updated) selectedTool.value = updated
  }
}

const isToolPanelOpen = computed({
  get() {
    return !!selectedTool.value
  },
  set(value: boolean) {
    if (!value) selectedTool.value = null
  }
})

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg')
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
        <UBadge :label="tools.length" variant="subtle" />
      </template>
    </UDashboardNavbar>
    <ToolsList v-model="selectedTool" :tools="tools" />
  </UDashboardPanel>

  <ToolsDetail v-if="selectedTool" :tool="selectedTool" @close="selectedTool = null" @saved="onToolSaved" />
  <div v-else class="hidden lg:flex flex-1 items-center justify-center">
    <p class="text-muted-foreground">Nothing here</p>
  </div>

  <ClientOnly>
    <USlideover v-if="isMobile" v-model:open="isToolPanelOpen">
      <template #content>
        <ToolsDetail v-if="selectedTool" :tool="selectedTool" @close="selectedTool = null" @saved="onToolSaved" />
      </template>
    </USlideover>
  </ClientOnly>
</template>
