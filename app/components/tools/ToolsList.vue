<script setup lang="ts">
import type { ToolFile } from '~/types'

const props = defineProps<{
  tools: ToolFile[]
}>()

const toolsRefs = ref<Record<string, Element | null>>({})
const selectedTool = defineModel<ToolFile | null>()

watch(selectedTool, () => {
  if (!selectedTool.value) return
  const ref = toolsRefs.value[selectedTool.value.id]
  if (ref) ref.scrollIntoView({ block: 'nearest' })
})
</script>

<template>
  <div class="overflow-y-auto divide-y divide-default">
    <div
      v-for="tool in tools"
      :key="tool.id"
      :ref="(el) => { toolsRefs[tool.id] = el as Element | null }"
    >
      <div
        class="p-4 sm:px-6 text-sm cursor-pointer border-l-2 transition-colors"
        :class="[
          selectedTool?.id === tool.id
            ? 'border-primary bg-primary/10 text-highlighted'
            : 'border-bg hover:border-primary hover:bg-primary/5 text-toned'
        ]"
        @click="selectedTool = tool"
      >
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-wrench" class="size-4 shrink-0 text-dimmed" />
          <span class="font-medium">{{ tool.name }}</span>
        </div>
        <p class="mt-0.5 text-dimmed text-xs">
          {{ tool.id }}.ts
        </p>
      </div>
    </div>
  </div>
</template>
