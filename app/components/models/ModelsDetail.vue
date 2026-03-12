<script setup lang="ts">
import type { ModelFile } from '~/types'

const props = defineProps<{
  model: ModelFile
}>()

const emits = defineEmits<{
  close: []
  saved: []
}>()

const toast = useToast()
const code = ref(props.model.content ?? '')
const saving = ref(false)

watch(
  () => props.model,
  (newModel) => {
    code.value = newModel.content ?? ''
  },
  { immediate: false }
)

async function save(): Promise<boolean> {
  if (saving.value) return false
  saving.value = true
  try {
    await $fetch(`/api/models/${props.model.id}`, {
      method: 'PUT',
      body: { content: code.value }
    })
    toast.add({
      title: 'Saved',
      description: `${props.model.name}.ts has been saved.`,
      icon: 'i-lucide-check',
      color: 'success'
    })
    emits('saved')
    return true
  } catch (e) {
    toast.add({
      title: 'Save failed',
      description: e instanceof Error ? e.message : 'Could not save file',
      icon: 'i-lucide-alert-circle',
      color: 'error'
    })
    return false
  } finally {
    saving.value = false
  }
}

defineShortcuts({
  meta_s: (e) => {
    e?.preventDefault()
    void save()
  },
  ctrl_s: (e) => {
    e?.preventDefault()
    void save()
  }
})

const editorOptions = {
  automaticLayout: true,
  formatOnType: true,
  formatOnPaste: true,
  minimap: { enabled: true },
  fontSize: 13,
  lineNumbers: 'on' as const,
  wordWrap: 'on' as const
}
</script>

<template>
  <UDashboardPanel id="models-detail">
    <UDashboardNavbar :title="model.name" :toggle="false">
      <template #leading>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          class="-ms-1.5"
          @click="emits('close')"
        />
      </template>
      <template #right>
        <UButton
          icon="i-lucide-save"
          color="primary"
          :loading="saving"
          label="Save"
          @click="() => void save()"
        />
      </template>
    </UDashboardNavbar>

    <div class="flex-1 flex flex-col min-h-0 p-4 sm:p-6">
      <p v-if="!model.content" class="text-muted-foreground">
        Nothing here
      </p>
      <ClientOnly v-else>
        <div class="flex-1 min-h-[400px] rounded-lg overflow-hidden border border-default">
          <vue-monaco-editor
            v-model:value="code"
            language="typescript"
            theme="vs-dark"
            :options="editorOptions"
            class="h-full min-h-[400px]"
          >
            <template #default>
              <span class="text-muted-foreground">Loading editor…</span>
            </template>
            <template #failure>
              <span class="text-destructive">Failed to load editor</span>
            </template>
          </vue-monaco-editor>
        </div>
      </ClientOnly>
    </div>
  </UDashboardPanel>
</template>
