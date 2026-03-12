<script setup lang="ts">
import { computed, ref } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { ModelFile } from '~/types'

const { data: models, refresh: refreshModels } = await useFetch<ModelFile[]>('/api/models', { default: () => [] })

const selectedModel = ref<ModelFile | null>(null)

async function onModelSaved() {
  await refreshModels()
  if (selectedModel.value) {
    const updated = models.value?.find((m) => m.id === selectedModel.value?.id)
    if (updated) selectedModel.value = updated
  }
}

const isModelPanelOpen = computed({
  get() {
    return !!selectedModel.value
  },
  set(value: boolean) {
    if (!value) selectedModel.value = null
  }
})

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg')
</script>

<template>
  <UDashboardPanel
    id="models-list"
    :default-size="25"
    :min-size="20"
    :max-size="30"
    resizable
  >
    <UDashboardNavbar title="Models">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UBadge :label="models.length" variant="subtle" />
      </template>
    </UDashboardNavbar>
    <ModelsList v-model="selectedModel" :models="models" />
  </UDashboardPanel>

  <ModelsDetail v-if="selectedModel" :model="selectedModel" @close="selectedModel = null" @saved="onModelSaved" />
  <div v-else class="hidden lg:flex flex-1 items-center justify-center">
    <p class="text-muted-foreground">Nothing here</p>
  </div>

  <ClientOnly>
    <USlideover v-if="isMobile" v-model:open="isModelPanelOpen">
      <template #content>
        <ModelsDetail v-if="selectedModel" :model="selectedModel" @close="selectedModel = null" @saved="onModelSaved" />
      </template>
    </USlideover>
  </ClientOnly>
</template>
