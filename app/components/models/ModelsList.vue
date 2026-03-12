<script setup lang="ts">
import type { ModelFile } from '~/types'

const props = defineProps<{
  models: ModelFile[]
}>()

const modelsRefs = ref<Record<string, Element | null>>({})
const selectedModel = defineModel<ModelFile | null>()

watch(selectedModel, () => {
  if (!selectedModel.value) return
  const ref = modelsRefs.value[selectedModel.value.id]
  if (ref) ref.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <div class="overflow-y-auto divide-y divide-default">
    <div
      v-for="model in models"
      :key="model.id"
      :ref="(el) => { modelsRefs[model.id] = el as Element | null }"
    >
      <div
        class="p-4 sm:px-6 text-sm cursor-pointer border-l-2 transition-colors"
        :class="[
          selectedModel?.id === model.id
            ? 'border-primary bg-primary/10 text-highlighted'
            : 'border-bg hover:border-primary hover:bg-primary/5 text-toned'
        ]"
        @click="selectedModel = model"
      >
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-box" class="size-4 shrink-0 text-dimmed" />
          <span class="font-medium">{{ model.name }}</span>
        </div>
        <p class="mt-0.5 text-dimmed text-xs">
          {{ model.id }}.ts
        </p>
      </div>
    </div>
  </div>
</template>
