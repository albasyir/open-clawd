<script setup lang="ts">
import type { ToolFile } from '~/types'

const props = defineProps<{
  tool: ToolFile
}>()

const emits = defineEmits<{
  close: []
  saved: []
}>()

const toast = useToast()
const code = ref(props.tool.content ?? '')
const saving = ref(false)
const testModalOpen = ref(false)
const testInput = ref('')
const testResult = ref<{ success: boolean; result?: unknown; error?: string } | null>(null)
const testing = ref(false)

const sampleInputs: Record<string, string> = {
  math: JSON.stringify({ a: 1, b: 2, operation: 'add' }, null, 2),
  'get-weather': JSON.stringify({ city: 'London' }, null, 2),
  cli: JSON.stringify({ command: 'echo hello' }, null, 2)
}

watch(
  () => props.tool,
  (newTool) => {
    code.value = newTool.content ?? ''
    testInput.value = sampleInputs[newTool.id] ?? '{}'
    testResult.value = null
  },
  { immediate: false }
)

function openTestModal() {
  testInput.value = sampleInputs[props.tool.id] ?? '{}'
  testResult.value = null
  testModalOpen.value = true
}

async function onSaveAndTestClick(): Promise<void> {
  const ok = await save()
  if (!ok) {
    toast.add({
      title: 'Cannot test',
      description: 'Save failed. Fix errors and try again.',
      color: 'error'
    })
    return
  }
  openTestModal()
}

async function runTest() {
  let inputObj: Record<string, unknown>
  try {
    inputObj = JSON.parse(testInput.value) as Record<string, unknown>
  } catch {
    toast.add({ title: 'Invalid JSON', description: 'Check the test input syntax.', color: 'error' })
    return
  }
  testing.value = true
  testResult.value = null
  try {
    const res = await $fetch<{ success: boolean; result?: unknown; error?: string }>(
      `/api/tools/${props.tool.id}/test`,
      { method: 'POST', body: { input: inputObj } }
    )
    testResult.value = res
    if (res.success) {
      toast.add({ title: 'Test passed', description: `Result: ${JSON.stringify(res.result)}`, color: 'success' })
    } else {
      toast.add({ title: 'Test failed', description: res.error, color: 'error' })
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    testResult.value = { success: false, error: err }
    toast.add({ title: 'Test error', description: err, color: 'error' })
  } finally {
    testing.value = false
  }
}

async function save(): Promise<boolean> {
  if (saving.value) return false
  saving.value = true
  try {
    await $fetch(`/api/tools/${props.tool.id}`, {
      method: 'PUT',
      body: { content: code.value }
    })
    toast.add({
      title: 'Saved',
      description: `${props.tool.name}.ts has been saved.`,
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
    save()
  },
  ctrl_s: (e) => {
    e?.preventDefault()
    save()
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
  <UDashboardPanel id="tools-detail">
    <UDashboardNavbar :title="tool.name" :toggle="false">
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
          icon="i-lucide-play"
          color="neutral"
          variant="outline"
          label="Save and Test"
          @click="onSaveAndTestClick"
        />
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
      <p v-if="!tool.content" class="text-muted-foreground">
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

    <UModal v-model:open="testModalOpen" title="Test tool">
      <template #body>
        <div class="p-4 space-y-4">
          <div>
            <label class="text-sm font-medium text-highlighted mb-1.5 block">Input (JSON)</label>
            <UTextarea
              v-model="testInput"
              :rows="8"
              class="font-mono text-sm"
              placeholder='e.g. { "a": 1, "b": 2, "operation": "add" }'
            />
          </div>
          <div v-if="testResult" class="rounded-lg p-3 text-sm" :class="testResult.success ? 'bg-success/10 text-success' : 'bg-error/10 text-error'">
            <span class="font-medium">{{ testResult.success ? 'Result' : 'Error' }}</span>
            <pre class="mt-1 whitespace-pre-wrap break-words">{{ testResult.success ? JSON.stringify(testResult.result, null, 2) : testResult.error }}</pre>
          </div>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="ghost" label="Close" @click="testModalOpen = false" />
            <UButton icon="i-lucide-play" :loading="testing" label="Run test" @click="runTest" />
          </div>
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
