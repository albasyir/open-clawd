<script setup lang="ts">
import type { ToolFile } from '~/types'

const props = withDefaults(
  defineProps<{
    tool: ToolFile
    /** When set, use this base for save/test (e.g. /api/agents/test). Omit for global /api/tools. */
    toolsApiBase?: string
    /** Whether to hide the 'Save and Test' button and test functionality */
    hideTest?: boolean
  }>(),
  { toolsApiBase: '' }
)

const toolsBase = computed(() => (props.toolsApiBase || '/api/toolbox').replace(/\/$/, ''))
const isSymlink = computed(() => !!props.tool.symlink)

const emits = defineEmits<{
  close: []
  saved: []
  copied: []
}>()

const toast = useToast()
const saving = ref(false)
const copying = ref(false)
const testModalOpen = ref(false)
const testInput = ref('')
const testResult = ref<{ success: boolean, result?: unknown, error?: string } | null>(null)
const testLog = ref<string[]>([])
const testing = ref(false)
const activeTestAbortController = ref<AbortController | null>(null)

type TestStreamChunk
  = { type: 'start', label: string }
    | { type: 'progress', data: unknown }
    | { type: 'result', success: boolean, result?: unknown, error?: string }

type EditorFile = {
  id: string
  name: string
  content: string
}

function fallbackFilename(tool: ToolFile): string {
  return tool.id.includes('.') ? tool.id : `${tool.id}.ts`
}

function getEditorFiles(tool: ToolFile): EditorFile[] {
  if (tool.files?.length) {
    return tool.files
  }

  return [{
    id: tool.id,
    name: fallbackFilename(tool),
    content: tool.content ?? ''
  }]
}

const activeFileId = ref('')
const fileDrafts = ref<Record<string, string>>({})
const editorFiles = computed(() => getEditorFiles(props.tool))
const activeEditorFile = computed(() => editorFiles.value.find(file => file.id === activeFileId.value) ?? editorFiles.value[0])
const hasMultipleEditorFiles = computed(() => editorFiles.value.length > 1)
const activeFileContent = computed({
  get() {
    const id = activeEditorFile.value?.id
    if (!id) return ''
    return fileDrafts.value[id] ?? activeEditorFile.value?.content ?? ''
  },
  set(value: string) {
    const id = activeEditorFile.value?.id
    if (!id) return
    fileDrafts.value = { ...fileDrafts.value, [id]: value }
  }
})

function resetEditorFiles(tool: ToolFile): void {
  const files = getEditorFiles(tool)
  fileDrafts.value = Object.fromEntries(files.map(file => [file.id, file.content]))
  activeFileId.value = files[0]?.id ?? ''
}

const sampleInputs: Record<string, string> = {
  'math': JSON.stringify({ a: 1, b: 2, operation: 'add' }, null, 2),
  'get-weather': JSON.stringify({ city: 'London' }, null, 2),
  'shell': JSON.stringify({ command: 'echo hello' }, null, 2),
  'cli': JSON.stringify({ command: 'echo hello' }, null, 2)
}

watch(
  () => props.tool,
  (newTool) => {
    resetEditorFiles(newTool)
    testInput.value = sampleInputs[newTool.id] ?? '{}'
    testResult.value = null
    testLog.value = []
  },
  { immediate: true }
)

function openTestModal() {
  testInput.value = sampleInputs[props.tool.id] ?? '{}'
  testResult.value = null
  testLog.value = []
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
  activeTestAbortController.value?.abort()
  const abortController = new AbortController()
  activeTestAbortController.value = abortController
  testing.value = true
  testResult.value = null
  testLog.value = []
  try {
    const response = await fetch(`${toolsBase.value}/${props.tool.id}/test/stream`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/x-ndjson'
      },
      body: JSON.stringify({ input: inputObj }),
      signal: abortController.signal
    })

    if (!response.ok || !response.body) {
      throw new Error(await response.text() || 'Failed to start test stream')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        handleTestStreamChunk(JSON.parse(trimmed) as TestStreamChunk)
      }
    }

    const trailing = buffer.trim()
    if (trailing) {
      handleTestStreamChunk(JSON.parse(trailing) as TestStreamChunk)
    }
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      return
    }
    const err = e instanceof Error ? e.message : String(e)
    testResult.value = { success: false, error: err }
    appendTestLog(`[error] ${err}`)
  } finally {
    if (activeTestAbortController.value === abortController) {
      activeTestAbortController.value = null
    }
    testing.value = false
  }
}

async function save(): Promise<boolean> {
  if (saving.value) return false
  saving.value = true
  try {
    await $fetch(`${toolsBase.value}/${props.tool.id}`, {
      method: 'PUT',
      body: props.tool.files
        ? { content: activeFileContent.value, file: activeFileId.value }
        : { content: activeFileContent.value }
    })
    toast.add({
      title: 'Saved',
      description: `${displayFilename.value} has been saved.`,
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

async function copyToLocal() {
  if (copying.value) return
  copying.value = true
  try {
    await $fetch(`${toolsBase.value}/${props.tool.id}/copy`, { method: 'POST' })
    toast.add({
      title: 'Copied',
      description: `${displayFilename.value} is now a local editable copy.`,
      icon: 'i-lucide-check',
      color: 'success'
    })
    emits('copied')
  } catch (e) {
    const msg = getErrorMessage(e, 'Failed to copy tool')
    toast.add({ title: 'Copy failed', description: msg, color: 'error' })
  } finally {
    copying.value = false
  }
}

const editorOptions = computed(() => ({
  automaticLayout: true,
  formatOnType: true,
  formatOnPaste: true,
  minimap: { enabled: true },
  fontSize: 13,
  lineNumbers: 'on' as const,
  wordWrap: 'on' as const,
  readOnly: isSymlink.value
}))

const testInputEditorOptions = {
  automaticLayout: true,
  formatOnPaste: true,
  formatOnType: true,
  minimap: { enabled: false },
  fontSize: 13,
  lineNumbers: 'on' as const,
  scrollBeyondLastLine: false,
  tabSize: 2,
  wordWrap: 'on' as const
}

const testResultEditorOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontSize: 13,
  lineNumbers: 'off' as const,
  readOnly: true,
  renderLineHighlight: 'none' as const,
  scrollBeyondLastLine: false,
  wordWrap: 'on' as const
}

const displayFilename = computed(() => activeEditorFile.value?.name ?? fallbackFilename(props.tool))
const editorLanguage = computed(() => displayFilename.value.endsWith('.md') ? 'markdown' : 'typescript')
const testLogText = computed(() => {
  if (testLog.value.length > 0) {
    return testLog.value.join('\n\n')
  }

  if (testing.value) {
    return 'Waiting for streamed progress...'
  }

  return 'Progress updates from the tool test will appear here.'
})

const testResultText = computed(() => {
  if (!testResult.value) {
    return testing.value
      ? 'Waiting for the tool to finish...'
      : 'Run a test to inspect the tool response here.'
  }

  if (testResult.value.success) {
    return JSON.stringify(testResult.value.result ?? null, null, 2)
  }

  return testResult.value.error ?? 'Unknown error'
})

const testResultLanguage = computed(() => testResult.value?.success ? 'json' : 'plaintext')
const testResultTone = computed(() => testResult.value?.success ? 'text-success' : 'text-error')

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'data' in error) {
    const data = (error as { data?: { message?: string } }).data
    if (typeof data?.message === 'string' && data.message) {
      return data.message
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallback
}

function formatTestLogChunk(data: unknown): string {
  if (typeof data === 'string') {
    return data
  }

  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

function appendTestLog(entry: string): void {
  testLog.value = [...testLog.value, entry]
}

function handleTestStreamChunk(chunk: TestStreamChunk): void {
  if (chunk.type === 'start') {
    appendTestLog(`[start] ${chunk.label}`)
    return
  }

  if (chunk.type === 'progress') {
    appendTestLog(formatTestLogChunk(chunk.data))
    return
  }

  testResult.value = chunk.success
    ? { success: true, result: chunk.result }
    : { success: false, error: chunk.error ?? 'Unknown error' }

  appendTestLog(chunk.success ? '[done] Tool finished successfully.' : `[done] ${chunk.error ?? 'Tool failed.'}`)
}

watch(testModalOpen, (isOpen) => {
  if (!isOpen) {
    activeTestAbortController.value?.abort()
  }
})
</script>

<template>
  <UDashboardPanel id="toolbox-detail">
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
          v-if="!isSymlink && !hideTest"
          icon="i-lucide-play"
          color="neutral"
          variant="outline"
          label="Save and Test"
          @click="onSaveAndTestClick"
        />
        <UButton
          v-if="!isSymlink"
          icon="i-lucide-save"
          color="primary"
          :loading="saving"
          label="Save"
          @click="() => void save()"
        />
      </template>
    </UDashboardNavbar>

    <div class="flex-1 flex flex-col min-h-0 p-4 sm:p-6">
      <div v-if="isSymlink" class="mb-3 flex flex-col gap-3">
        <p class="text-sm text-dimmed">
          This tool is a symlink and can't be edited here.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <UButton
            color="neutral"
            variant="outline"
            icon="i-lucide-copy"
            label="Copy tool for this agent"
            :loading="copying"
            @click="copyToLocal"
          />
          <UButton
            color="primary"
            variant="outline"
            label="Edit globally"
            :to="`/toolbox/${tool.id}`"
            icon="i-lucide-external-link"
          />
        </div>
      </div>
      <div v-if="hasMultipleEditorFiles" class="mb-3 flex items-center gap-2 overflow-x-auto">
        <div role="tablist" class="inline-flex rounded-md border border-default bg-elevated/20 p-1">
          <UButton
            v-for="file in editorFiles"
            :key="file.id"
            :label="file.name"
            color="neutral"
            size="xs"
            :variant="activeFileId === file.id ? 'solid' : 'ghost'"
            role="tab"
            :aria-selected="activeFileId === file.id"
            @click="activeFileId = file.id"
          />
        </div>
      </div>
      <p v-if="!activeEditorFile && !isSymlink" class="text-muted-foreground">
        Nothing here
      </p>
      <ClientOnly v-else>
        <div class="flex-1 min-h-[400px] rounded-lg overflow-hidden border border-default">
          <vue-monaco-editor
            v-model:value="activeFileContent"
            :language="editorLanguage"
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

    <UModal
      v-model:open="testModalOpen"
      title="Test tool"
      fullscreen
      :ui="{
        content: 'inset-0 h-dvh',
        body: 'flex-1 overflow-hidden p-0',
        footer: 'border-t border-default'
      }"
    >
      <template #body>
        <div class="flex h-full min-h-0 flex-col lg:flex-row">
          <div class="flex min-h-0 flex-1 flex-col border-b border-default lg:border-r lg:border-b-0">
            <div class="flex items-center justify-between gap-3 border-b border-default px-4 py-3">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  Input
                </p>
                <p class="text-xs text-dimmed">
                  Provide JSON passed into the tool test endpoint.
                </p>
              </div>
              <UBadge label="JSON" variant="subtle" color="neutral" />
            </div>
            <ClientOnly>
              <div class="min-h-0 flex-1">
                <vue-monaco-editor
                  v-model:value="testInput"
                  language="json"
                  theme="vs-dark"
                  :options="testInputEditorOptions"
                  class="h-full"
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

          <div class="flex min-h-0 flex-1 flex-col">
            <div class="flex items-center justify-between gap-3 border-b border-default px-4 py-3">
              <div>
                <p class="text-sm font-medium text-highlighted">
                  Result
                </p>
                <p class="text-xs text-dimmed">
                  The latest test output is shown here.
                </p>
              </div>
              <span class="text-xs font-medium" :class="testResult ? testResultTone : 'text-dimmed'">
                {{ testResult ? (testResult.success ? 'Success' : 'Error') : 'Waiting for run' }}
              </span>
            </div>
            <div class="h-48 shrink-0 overflow-y-auto border-b border-default bg-elevated/20 px-4 py-3">
              <pre class="whitespace-pre-wrap break-words text-xs text-dimmed">{{ testLogText }}</pre>
            </div>
            <ClientOnly>
              <div class="min-h-0 flex-1">
                <vue-monaco-editor
                  :value="testResultText"
                  :language="testResultLanguage"
                  theme="vs-dark"
                  :options="testResultEditorOptions"
                  class="h-full"
                >
                  <template #default>
                    <span class="text-muted-foreground">Loading result…</span>
                  </template>
                  <template #failure>
                    <span class="text-destructive">Failed to load editor</span>
                  </template>
                </vue-monaco-editor>
              </div>
            </ClientOnly>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Close"
            @click="testModalOpen = false"
          />
          <UButton
            icon="i-lucide-play"
            :loading="testing"
            label="Run test"
            @click="runTest"
          />
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
