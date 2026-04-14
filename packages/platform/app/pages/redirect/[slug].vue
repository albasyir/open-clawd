<script lang="ts" setup>
definePageMeta({
   name: 'redirect',
});

const route = useRoute()

const allowedRedirect = reactive({
   feedback: {
      name: 'Feedback',
      url: 'https://github.com/albasyir/clawpro/issues'
   },
   github: {
      name: 'Github',
      url: 'https://github.com/albasyir/clawpro'
   },
   hq: {
      name: 'Head Quarters',
      url: 'https://github.io/clawpro'
   },
   docs: {
      name: 'Documentation',
      url: 'https://github.io/clawpro/docs'
   }
})

const slug = computed<keyof allowedRedirect>(() => {
   const slug = route.params['slug'];

   if(typeof slug !== 'string') throw createError("slug was not found");

   console.log('changes', slug)
   
   return slug
})

const redirectSource = computed(() => {
   return allowedRedirect[slug.value]
})

// TODO: not hendled yet
const isAllowed = computed(() => {
   return !redirectSource
})
</script>

<template>
  <UDashboardPanel id="redirect">
    <template #header>
      <UDashboardNavbar title="Redirecting...">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body v-if="isAllowed">
      <div class="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
        <UIcon
          name="i-lucide-construction"
          class="size-20 text-primary-500 dark:text-primary-400"
          aria-hidden
        />
        <div class="space-y-2">
          <h1 class="text-2xl font-semibold text-default">
            This window will open {{  redirectSource.name  }} page
          </h1>
          <p class="text-dimmed">
            link <b v-text="redirectSource.url" /> is officially registered
          </p>
        </div>
        <UButton
          to="/agents"
          color="primary"
          variant="soft"
          trailing-icon="i-lucide-arrow-right"
        >
          It's no go anywhere? click this
        </UButton>
      </div>
    </template>
  </UDashboardPanel>
</template>
