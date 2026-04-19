<script setup lang="ts">
import type { SkillSearchResponse, SkillSearchResult } from '~/types'

const route = useRoute()
const router = useRouter()

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

    await router.replace({
      path: '/skills',
      query: {
        q: searchQuery,
        limit: searchLimit.toString()
      }
    })
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
                <UTooltip text="Open GitHub repository">
                  <UButton
                    icon="i-lucide-github"
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
</template>
