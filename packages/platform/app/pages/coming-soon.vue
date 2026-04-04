<script setup lang="ts">
</script>

<template>
  <UDashboardPanel id="coming-soon">
    <template #header>
      <UDashboardNavbar title="Coming Soon">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center px-4">
        <UIcon
          name="i-lucide-construction"
          class="size-20 text-primary-500 dark:text-primary-400"
          aria-hidden
        />
        <div class="space-y-2">
          <h1 class="text-2xl font-semibold text-default">
            Coming Soon
          </h1>
          <p class="text-dimmed max-w-md">
            This page is under construction. We're working on something great — check back later.
          </p>
        </div>
        <UButton
          to="/agents"
          color="primary"
          variant="soft"
          trailing-icon="i-lucide-arrow-right"
        >
          Back to Agents
        </UButton>
      </div>
    </template>
  </UDashboardPanel>
</template>
