import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { useRoute } from 'vue-router'

export const useAppStore = defineStore('app', () => {
  const sidebarCollapsed = ref(false)
  const route = useRoute()
  const breadcrumbs = computed(() => route.matched.filter((item) => item.meta.title).map((item) => ({ title: String(item.meta.title), path: item.path })))

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  return { sidebarCollapsed, breadcrumbs, toggleSidebar }
})
