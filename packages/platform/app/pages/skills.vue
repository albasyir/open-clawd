<script setup lang="ts">
import type { SkillSearchResponse, SkillSearchResult } from '~/types'

const route = useRoute()
const router = useRouter()
const toast = useToast()

const limitItems = [10, 25, 50, 100].map(value => ({ label: value.toString(), value }))
const debounceMs = 1000

type SkillSearchError = {
  code: string
  message: string
}

function normalizeLimit(value: unknown) {
  const parsed = typeof value === 'string' ? Number(value) : Number.NaN
  return limitItems.some(item => item.value === parsed) ? parsed : 100
}

function getFetchError(err: unknown): SkillSearchError {
  if (err && typeof err === 'object') {
    const fetchError = err as {
      data?: {
        message?: unknown
        statusCode?: unknown
        statusMessage?: unknown
      }
      message?: unknown
      response?: { status?: unknown }
      status?: unknown
      statusCode?: unknown
      statusMessage?: unknown
    }
    const statusCode = fetchError.data?.statusCode ?? fetchError.statusCode ?? fetchError.response?.status ?? fetchError.status
    const message = fetchError.data?.message ?? fetchError.data?.statusMessage ?? fetchError.statusMessage ?? fetchError.message

    return {
      code: typeof statusCode === 'number' || typeof statusCode === 'string' ? String(statusCode) : 'unknown',
      message: typeof message === 'string' && message ? message : 'Failed to search skills.'
    }
  }

  return {
    code: 'unknown',
    message: 'Failed to search skills.'
  }
}

const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const limit = ref(normalizeLimit(route.query.limit))
const skills = ref<SkillSearchResult[]>([])
const searchType = ref('')
const isDebouncing = ref(false)
const isFetching = ref(false)
const error = ref<SkillSearchError | null>(null)
const hasSearched = ref(false)
const installingSkills = ref<Set<string>>(new Set())
const uninstallingSkills = ref<Set<string>>(new Set())
const installedSkills = ref<Set<string>>(new Set())
const checkingInstallation = ref(false)
const pendingInstallSkill = ref<SkillSearchResult | null>(null)
const installAcknowledged = ref(false)

const trimmedQuery = computed(() => query.value.trim())
const loading = computed(() => isDebouncing.value || isFetching.value)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let searchRunId = 0
let stopSearchWatch: (() => void) | null = null

function formatInstalls(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function clearDebounceTimer() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
}

function resetSearchState() {
  skills.value = []
  searchType.value = ''
  error.value = null
  hasSearched.value = false
}

function clearSearch() {
  searchRunId += 1
  clearDebounceTimer()
  isDebouncing.value = false
  isFetching.value = false
  resetSearchState()
  void router.replace({ path: '/skills' })
}

function syncSearchRoute(searchQuery: string, searchLimit: number) {
  void router.replace({
    path: '/skills',
    query: searchQuery
      ? {
          q: searchQuery,
          limit: searchLimit.toString()
        }
      : undefined
  })
}

async function searchSkills(searchQuery: string, searchLimit: number, runId: number) {
  isFetching.value = true
  error.value = null

  try {
    const result = await $fetch<SkillSearchResponse>('/api/skills/search', {
      query: {
        q: searchQuery,
        limit: searchLimit
      }
    })

    if (runId !== searchRunId) return

    searchType.value = result.searchType
    skills.value = result.skills
    hasSearched.value = true
    void checkSkillInstallation(result.skills)
  } catch (err) {
    if (runId !== searchRunId) return

    skills.value = []
    searchType.value = ''
    error.value = getFetchError(err)
  } finally {
    if (runId === searchRunId) {
      isFetching.value = false
    }
  }
}

function scheduleSearch() {
  const searchQuery = trimmedQuery.value
  const searchLimit = limit.value

  if (!searchQuery) {
    clearSearch()
    return
  }

  searchRunId += 1
  clearDebounceTimer()
  isFetching.value = false
  syncSearchRoute(searchQuery, searchLimit)

  if (searchQuery.length > 200) {
    isDebouncing.value = false
    skills.value = []
    searchType.value = ''
    error.value = { code: '400', message: 'Search query must be 200 characters or fewer.' }
    hasSearched.value = false
    return
  }

  const runId = searchRunId
  error.value = null
  isDebouncing.value = true

  debounceTimer = setTimeout(() => {
    debounceTimer = null
    if (runId !== searchRunId) return

    isDebouncing.value = false
    void searchSkills(searchQuery, searchLimit, runId)
  }, debounceMs)
}

function setInstalling(skillId: string, installing: boolean) {
  const next = new Set(installingSkills.value)
  if (installing) {
    next.add(skillId)
  } else {
    next.delete(skillId)
  }
  installingSkills.value = next
}

function setUninstalling(skillId: string, uninstalling: boolean) {
  const next = new Set(uninstallingSkills.value)
  if (uninstalling) {
    next.add(skillId)
  } else {
    next.delete(skillId)
  }
  uninstallingSkills.value = next
}

function markInstalled(skillId: string) {
  installedSkills.value = new Set([...installedSkills.value, skillId])
}

function markUninstalled(skillId: string) {
  const next = new Set(installedSkills.value)
  next.delete(skillId)
  installedSkills.value = next
}

async function checkSkillInstallation(skillList: SkillSearchResult[]) {
  checkingInstallation.value = true
  try {
    const result = await $fetch<{ skills: Array<{ id: string; installed: boolean }> }>('/api/skills/installation', {
      method: 'POST',
      body: {
        skills: skillList.map(skill => ({
          id: skill.id,
          skillId: skill.skillId,
          source: skill.source
        }))
      }
    })

    installedSkills.value = new Set(result.skills.filter(skill => skill.installed).map(skill => skill.id))
  } catch (err) {
    const checkError = getFetchError(err)
    toast.add({
      title: `Install status check failed (${checkError.code})`,
      description: checkError.message,
      color: 'error'
    })
  } finally {
    checkingInstallation.value = false
  }
}

async function installSkill(skill: SkillSearchResult) {
  if (installingSkills.value.has(skill.id) || installedSkills.value.has(skill.id)) return

  setInstalling(skill.id, true)
  try {
    await $fetch('/api/skills/install', {
      method: 'POST',
      body: {
        id: skill.id,
        skillId: skill.skillId,
        source: skill.source
      }
    })
    markInstalled(skill.id)
    toast.add({
      title: 'Skill installed',
      description: skill.name,
      color: 'success'
    })
  } catch (err) {
    const installError = getFetchError(err)
    toast.add({
      title: `Install failed (${installError.code})`,
      description: installError.message,
      color: 'error'
    })
  } finally {
    setInstalling(skill.id, false)
  }
}

function openInstallDialog(skill: SkillSearchResult) {
  if (installingSkills.value.has(skill.id) || installedSkills.value.has(skill.id)) return
  installAcknowledged.value = false
  pendingInstallSkill.value = skill
}

async function confirmInstallSkill() {
  const skill = pendingInstallSkill.value
  if (!skill) return

  await installSkill(skill)
  if (installedSkills.value.has(skill.id)) {
    pendingInstallSkill.value = null
    installAcknowledged.value = false
  }
}

async function uninstallSkill(skill: SkillSearchResult) {
  if (uninstallingSkills.value.has(skill.id) || !installedSkills.value.has(skill.id)) return

  setUninstalling(skill.id, true)
  try {
    await $fetch('/api/skills/uninstall', {
      method: 'POST',
      body: {
        id: skill.id,
        skillId: skill.skillId,
        source: skill.source
      }
    })
    markUninstalled(skill.id)
    toast.add({
      title: 'Skill uninstalled',
      description: skill.name,
      color: 'success'
    })
  } catch (err) {
    const uninstallError = getFetchError(err)
    toast.add({
      title: `Uninstall failed (${uninstallError.code})`,
      description: uninstallError.message,
      color: 'error'
    })
  } finally {
    setUninstalling(skill.id, false)
  }
}

function toggleSkillInstall(skill: SkillSearchResult) {
  if (installedSkills.value.has(skill.id)) {
    void uninstallSkill(skill)
  } else {
    openInstallDialog(skill)
  }
}

onMounted(() => {
  stopSearchWatch = watch([trimmedQuery, limit], scheduleSearch, { immediate: true })
})

onBeforeUnmount(() => {
  clearDebounceTimer()
  stopSearchWatch?.()
})
</script>

<template>
  <UDashboardPanel id="skills-search">
    <template #header>
      <UDashboardNavbar title="Skills">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <div
          class="grid shrink-0 gap-3 px-4 transition-all duration-300 ease-out sm:px-6 lg:grid-cols-[minmax(0,1fr)_8rem] lg:items-center"
          :class="trimmedQuery
            ? 'border-b border-default py-4'
            : 'mx-auto mt-[32vh] w-full max-w-2xl'"
        >
          <UInput
            v-model="query"
            icon="i-lucide-search"
            placeholder="Search skills"
            :ui="{ base: 'font-mono' }"
          />
          <USelect
            v-model="limit"
            :items="limitItems"
            icon="i-lucide-list-filter"
          />
        </div>

        <div v-if="!trimmedQuery" class="flex-1" />

        <div v-else-if="error" class="flex-1 overflow-y-auto">
          <ul class="divide-y divide-default">
            <li class="px-4 py-6 sm:px-6">
              <div class="flex items-start gap-3 rounded-lg border border-error/25 bg-error/10 p-4">
                <UIcon name="i-lucide-alert-circle" class="mt-0.5 size-5 shrink-0 text-error" />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-sm font-semibold text-highlighted">
                      Search failed
                    </p>
                    <UBadge color="error" variant="subtle" :label="`HTTP ${error.code}`" />
                  </div>
                  <p class="mt-2 break-words font-mono text-xs text-error">
                    {{ error.message }}
                  </p>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <div v-else-if="hasSearched && skills.length === 0" class="flex flex-1 items-center justify-center p-6">
          <div class="text-center">
            <UIcon name="i-lucide-search-x" class="mx-auto mb-3 size-12 text-dimmed" />
            <p class="text-sm font-medium text-highlighted">
              No skills found
            </p>
            <p class="mt-1 text-xs text-dimmed">
              {{ trimmedQuery }}
            </p>
          </div>
        </div>

        <div v-else class="flex-1 overflow-y-auto">
          <ul class="divide-y divide-default">
            <li v-if="loading" class="px-4 py-4 sm:px-6">
              <div class="flex items-center gap-3 text-sm text-dimmed">
                <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
                <span>{{ isDebouncing ? 'Waiting to search...' : 'Searching...' }}</span>
              </div>
            </li>
            <li
              v-for="skill in skills"
              :key="skill.id"
              class="grid gap-3 px-4 py-4 transition-colors hover:bg-elevated/50 sm:px-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
            >
              <div class="min-w-0">
                <div class="flex min-w-0 items-center gap-2">
                  <UIcon name="i-lucide-sparkles" class="size-4 shrink-0 text-primary" />
                  <h2 class="truncate text-sm font-semibold text-highlighted">
                    {{ skill.name }}
                  </h2>
                  <UBadge
                    :label="formatInstalls(skill.installs)"
                    icon="i-lucide-download"
                    color="neutral"
                    variant="subtle"
                    class="shrink-0"
                  />
                </div>
                <p class="mt-1 truncate font-mono text-xs text-dimmed">
                  {{ skill.id }}
                </p>
              </div>

              <div class="flex items-center justify-end gap-2">
                <UButton
                  :icon="installedSkills.has(skill.id) ? 'i-lucide-trash-2' : 'i-lucide-download'"
                  :label="checkingInstallation ? 'Checking' : installedSkills.has(skill.id) ? 'Uninstall' : 'Install'"
                  :loading="installingSkills.has(skill.id) || uninstallingSkills.has(skill.id) || checkingInstallation"
                  :disabled="checkingInstallation"
                  :color="installedSkills.has(skill.id) ? 'error' : 'primary'"
                  :variant="installedSkills.has(skill.id) ? 'soft' : 'solid'"
                  size="sm"
                  @click="toggleSkillInstall(skill)"
                />
                <UTooltip text="Open GitHub repository">
                  <UButton
                    icon="i-lucide-github"
                    label="GitHub"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :to="`https://github.com/${skill.source}`"
                    target="_blank"
                  />
                </UTooltip>
                <UTooltip text="Open on skills.sh">
                  <UButton
                    icon="i-lucide-external-link"
                    label="Skills"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :to="`https://skills.sh/${skill.id}`"
                    target="_blank"
                  />
                </UTooltip>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <UModal v-model:open="pendingInstallSkill" title="Install skill">
    <template #body>
      <div v-if="pendingInstallSkill" class="space-y-4 p-4">
        <div class="space-y-1">
          <p class="text-sm font-semibold text-highlighted">
            {{ pendingInstallSkill.name }}
          </p>
          <p class="break-all font-mono text-xs text-dimmed">
            {{ pendingInstallSkill.id }}
          </p>
        </div>

        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="text-xs text-dimmed">Skill ID</dt>
            <dd class="truncate font-mono text-toned">{{ pendingInstallSkill.skillId }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-xs text-dimmed">Source</dt>
            <dd class="truncate font-mono text-toned">{{ pendingInstallSkill.source }}</dd>
          </div>
          <div class="min-w-0">
            <dt class="text-xs text-dimmed">Installs</dt>
            <dd class="text-toned">{{ formatInstalls(pendingInstallSkill.installs) }}</dd>
          </div>
        </dl>

        <UCheckbox
          v-model="installAcknowledged"
        >
          <template #label>
            <span>
              I have reviewed and accept the Publisher and Security Audits on
              <ULink
                :to="`https://skills.sh/${pendingInstallSkill.id}`"
                target="_blank"
                class="text-primary underline-offset-2 hover:underline"
              >
                skills.sh
              </ULink>
            </span>
          </template>
        </UCheckbox>

        <div class="flex justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Cancel"
            :disabled="installingSkills.has(pendingInstallSkill.id)"
            @click="pendingInstallSkill = null; installAcknowledged = false"
          />
          <UButton
            icon="i-lucide-download"
            label="Install"
            :loading="installingSkills.has(pendingInstallSkill.id)"
            :disabled="!installAcknowledged"
            @click="confirmInstallSkill"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
