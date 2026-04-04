<script setup lang="ts">
import { ref } from 'vue'

const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{
  created: [agentId: string]
}>()

const name = ref('')
const template = ref('default')
const templates = ref<{ id: string, name: string }[]>([])
const loadingTemplates = ref(false)
const saving = ref(false)
const error = ref('')
const toast = useToast()

watch(open, async (isOpen) => {
  if (isOpen) {
    name.value = ''
    error.value = ''
    template.value = 'default'
    if (templates.value.length === 0) {
      loadingTemplates.value = true
      try {
        const res = await $fetch<{ id: string, name: string }[]>('/api/agents/templates')
        templates.value = res || []
      } catch (err) {
        toast.add({ title: 'Error loading templates', color: 'error' })
      } finally {
        loadingTemplates.value = false
      }
    }
  }
})

async function submit() {
  const tName = name.value.trim().replace(/\s+/g, '-').toLowerCase()
  const tTemplate = template.value.trim()
  
  if (!tName) {
    error.value = 'Agent name is required'
    return
  }
  if (!/^[a-z0-9_-]+$/i.test(tName)) {
    error.value = 'Use only letters, numbers, hyphen or underscore'
    return
  }
  if (!tTemplate) {
    error.value = 'Template is required'
    return
  }

  error.value = ''
  saving.value = true
  try {
    const res = await $fetch<{ id: string }>('/api/agents', {
      method: 'POST',
      body: { name: tName, template: tTemplate }
    })
    
    toast.add({ title: 'Agent created', color: 'success' })
    open.value = false
    emit('created', res.id)
  } catch (err: any) {
    error.value = err?.data?.message ?? err?.message ?? 'Failed to create agent'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal v-model:open="open" title="Create New Agent">
    <template #body>
      <div class="space-y-4 p-4">
        <div>
          <label class="mb-1.5 block text-sm font-medium text-highlighted">Agent name</label>
          <UInput
            v-model="name"
            placeholder="e.g. my-awesome-agent"
            class="font-mono"
            :disabled="saving"
            @keydown.enter="submit"
          />
          <p class="mt-1 text-xs text-dimmed">Letters, numbers, hyphen or underscore only. Must be unique.</p>
        </div>
        <div>
          <label class="mb-1.5 block text-sm font-medium text-highlighted">Template</label>
          <USelect
            v-model="template"
            :items="templates.map(t => ({ label: t.name, value: t.id }))"
            placeholder="Select a template"
            :disabled="saving || loadingTemplates"
            :loading="loadingTemplates"
          />
        </div>
        <p v-if="error" class="text-sm text-error">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <UButton color="neutral" variant="ghost" label="Cancel" :disabled="saving" @click="open = false" />
          <UButton icon="i-lucide-plus" label="Create Agent" :loading="saving" @click="submit" />
        </div>
      </div>
    </template>
  </UModal>
</template>
