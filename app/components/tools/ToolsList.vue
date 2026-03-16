<script setup lang="ts">
import type { ToolFile } from '~/types'

withDefaults(
  defineProps<{
    tools: ToolFile[]
    /** When true, show remove button per tool (unchain for symlink, delete for regular). */
    removable?: boolean
    /** Called when user clicks remove; only used when removable is true. */
    onRemove?: (tool: ToolFile) => void
    /** Called when user clicks promote; only shown for non-symlink tools. */
    onPromote?: (tool: ToolFile) => void
    /** Optional string to override the default tool icon. */
    icon?: string
  }>(),
  { removable: false, icon: 'i-lucide-wrench' }
)

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
        class="flex items-start gap-2 p-4 text-sm sm:px-6"
        :class="[
          selectedTool?.id === tool.id
            ? 'border-primary bg-primary/10 text-highlighted border-l-2'
            : 'border-bg hover:border-primary hover:bg-primary/5 text-toned border-l-2'
        ]"
      >
        <div
          class="min-w-0 flex-1 cursor-pointer transition-colors"
          @click="selectedTool = tool"
        >
          <div class="flex items-center gap-2">
            <UIcon :name="icon" class="size-4 shrink-0 text-dimmed" />
            <span class="font-medium">{{ tool.name }}</span>
            <UIcon
              v-if="tool.symlink"
              name="i-lucide-link"
              class="size-3.5 shrink-0 text-dimmed"
              title="Symlink (read-only)"
            />
          </div>
          <p class="mt-0.5 text-dimmed text-xs">
            {{ tool.id.includes('.') ? tool.id : `${tool.id}.ts` }}
            <span v-if="tool.symlink" class="ml-1">(symlink)</span>
          </p>
        </div>
        <UTooltip v-if="onPromote && !tool.symlink" text="Promote to global">
          <UButton
            icon="i-lucide-arrow-up-from-line"
            color="neutral"
            variant="ghost"
            size="xs"
            class="shrink-0"
            @click.stop="onPromote(tool)"
          />
        </UTooltip>
        <UTooltip v-if="removable && onRemove" :text="tool.symlink ? 'Unlink from agent' : 'Delete tool'">
          <UButton
            :icon="tool.symlink ? 'i-lucide-unlink' : 'i-lucide-trash-2'"
            color="neutral"
            variant="ghost"
            size="xs"
            class="shrink-0 -me-1"
            @click.stop="onRemove(tool)"
          />
        </UTooltip>
      </div>
    </div>
  </div>
</template>
