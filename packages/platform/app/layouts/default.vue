<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const toast = useToast()

const open = ref(false)

const links = [[
  {
    label: 'Channels',
    icon: 'i-lucide-channel',
    to: '/channels',
    onSelect: () => {
      open.value = false
    }
  },
  {
    label: 'Agents',
    icon: 'i-lucide-users',
    to: '/agents',
    onSelect: () => {
      open.value = false
    }
  }, {
    label: 'Skills',
    icon: 'i-lucide-sparkles',
    to: '/skills',
    onSelect: () => {
      open.value = false
    }
  }, {
    label: 'Toolbox',
    icon: 'i-lucide-wrench',
    to: '/toolbox',
    onSelect: () => {
      open.value = false
    }
  }, {
    label: 'Models',
    icon: 'i-lucide-box',
    to: '/models',
    onSelect: () => {
      open.value = false
    }
  }
], [{
  label: 'Feedback',
  icon: 'i-lucide-message-circle',
  to: '/redirect/feedback',
  onSelect: () => {
    open.value = false
  }
}, {
  label: 'Help & Support',
  icon: 'i-lucide-info',
  to: '/redirect/help',
  onSelect: () => {
    open.value = false
  }
}]] satisfies NavigationMenuItem[][]

const groups = computed(() => [{
  id: 'links',
  label: 'Go to',
  items: links.flat()
}, {
  id: 'code',
  label: 'Code',
  items: [{
    id: 'source',
    label: 'View page source',
    icon: 'i-simple-icons-github',
    to: '/coming-soon'
  }]
}])

onMounted(async () => {
  const cookie = useCookie('cookie-consent')
  if (cookie.value === 'accepted') {
    return
  }

  toast.add({
    title: 'We use first-party cookies to enhance your experience on our website.',
    duration: 0,
    close: false,
    actions: [{
      label: 'Accept',
      color: 'neutral',
      variant: 'outline',
      onClick: () => {
        cookie.value = 'accepted'
      }
    }, {
      label: 'Opt out',
      color: 'neutral',
      variant: 'ghost'
    }]
  })
})
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <TeamsMenu :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" class="bg-transparent ring-default" />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
          tooltip
          popover
        />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[1]"
          orientation="vertical"
          tooltip
          class="mt-auto"
        />
      </template>

      <template #footer="{ collapsed }">
        <UserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <slot />

    <NotificationsSlideover />
  </UDashboardGroup>
</template>
