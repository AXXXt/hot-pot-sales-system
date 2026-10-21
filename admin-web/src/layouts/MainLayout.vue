<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { ElNotification } from 'element-plus'
import { Fold, Expand, SwitchButton } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'
import { getLeadStats } from '../api/lead'
import AiAssistantHost from '../components/ai/AiAssistantHost.vue'
import PlatformVersionNotice from '../components/platform/PlatformVersionNotice.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const app = useAppStore()
const profileReady = ref(false)

const localMenus = [
  { code: 'dashboard:view', name: '工作台', path: '/dashboard', icon: 'DataBoard' },
  { code: 'product:read', name: '商品管理', path: '/products', icon: 'Goods' },
  { code: 'brand:manage', name: '品牌管理', path: '/products/brands', icon: 'CollectionTag' },
  { code: 'product:read', name: '分类管理', path: '/products/categories', icon: 'Menu' },
  { code: 'inventory:read', name: '库存管理', path: '/inventory', icon: 'Box' },
  { code: 'customer:manage', name: '客户管理', path: '/customers', icon: 'UserFilled' },
  { code: 'lead:read', name: '获客线索', path: '/leads', icon: 'Connection' },
  { code: 'order:read', name: '订单管理', path: '/orders', icon: 'Document' },
  { code: 'role:manage', name: '用户与角色', path: '/users', icon: 'Avatar' },
]
const bottomMenus = [
  { code: 'ai:configure', name: 'AI 助手配置', path: '/ai-settings', icon: 'ChatDotRound' },
  { code: 'audit:read', name: '审计日志', path: '/audit-logs', icon: 'Clock' },
  { code: 'role:manage', name: '系统配置', path: '/system', icon: 'Setting' },
]
const menus = computed(() => localMenus.filter((item) => auth.can(item.code)))
const bottom = computed(() => bottomMenus.filter((item) => auth.can(item.code)))

const newLeadCount = ref(0)
let leadPollTimer: ReturnType<typeof setInterval> | null = null

const dataOf = (r: any) => r?.data ?? r ?? {}

async function refreshLeadStats(initial = false) {
  if (!auth.can('lead:read')) return
  try {
    const res: any = await getLeadStats()
    const count = dataOf(res).newCount || 0
    if (!initial && count > newLeadCount.value) {
      ElNotification({
        title: '新获客线索',
        message: `有 ${count - newLeadCount.value} 条新留资，请及时跟进`,
        type: 'success',
        duration: 6000
      })
    }
    newLeadCount.value = count
  } catch { /* 静默失败，不影响主流程 */ }
}

function startLeadPolling() {
  if (leadPollTimer) return
  refreshLeadStats(true)
  leadPollTimer = setInterval(() => refreshLeadStats(), 60_000)
}

function stopLeadPolling() {
  if (leadPollTimer) { clearInterval(leadPollTimer); leadPollTimer = null }
}

onMounted(async () => {
  if (window.matchMedia('(max-width: 640px)').matches && !app.sidebarCollapsed) {
    app.toggleSidebar()
  }
  if (!auth.accessToken) return
  startLeadPolling()
  if (auth.profile) { profileReady.value = true; return }
  try {
    await auth.loadProfile()
    profileReady.value = true
  } catch {
    auth.reset()
    router.replace('/login')
  }
})

onUnmounted(stopLeadPolling)

async function handleLogout() {
  await auth.signOut()
  await router.replace('/login')
}

function handleMenuSelect() {
  if (window.matchMedia('(max-width: 640px)').matches && !app.sidebarCollapsed) {
    app.toggleSidebar()
  }
}
</script>

<template>
  <el-container class="shell">
    <button v-if="!app.sidebarCollapsed" class="sidebar-backdrop" aria-label="关闭导航" @click="app.toggleSidebar" />
    <el-aside :width="app.sidebarCollapsed ? '64px' : '220px'" class="sidebar" :class="{ 'sidebar--hidden': app.sidebarCollapsed }">
      <div class="brand"><img class="brand-mark" src="/brand/logo.jpg" alt="唯哆鲜" /><strong v-if="!app.sidebarCollapsed">唯哆鲜运营台</strong></div>
      <el-menu router :collapse="app.sidebarCollapsed" :default-active="route.path" class="nav" @select="handleMenuSelect">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <el-badge v-if="item.path === '/leads' && newLeadCount > 0" :value="newLeadCount" :max="99" class="lead-badge">
            <span>{{ item.name }}</span>
          </el-badge>
          <span v-else>{{ item.name }}</span>
        </el-menu-item>
      </el-menu>
      <div style="flex:1" />
      <a class="platform-menu-link" href="/platform-updates" target="_blank" rel="noopener"><el-icon><Refresh /></el-icon><span v-if="!app.sidebarCollapsed">版本与更新</span></a>
      <el-menu router :collapse="app.sidebarCollapsed" :default-active="route.path" class="nav-bottom" @select="handleMenuSelect">
        <el-menu-item v-for="item in bottom" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.name }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <el-button text :icon="app.sidebarCollapsed ? Expand : Fold" aria-label="切换导航" @click="app.toggleSidebar" />
        <el-breadcrumb separator="/">
          <el-breadcrumb-item v-for="item in app.breadcrumbs" :key="item.path">{{ item.title }}</el-breadcrumb-item>
        </el-breadcrumb>
        <div class="header-spacer" />
        <PlatformVersionNotice v-if="profileReady" />
        <span class="user-name">{{ auth.profile?.user.name }}</span>
        <el-button text :icon="SwitchButton" @click="handleLogout">退出</el-button>
      </el-header>
      <el-main class="main">
        <div v-if="!profileReady" class="loading-state"><span>加载中…</span></div>
        <router-view v-else />
      </el-main>
    </el-container>
    <AiAssistantHost v-if="profileReady" />
  </el-container>
</template>

<style scoped>

.shell { min-height: 100vh; background: white; }
.shell > :deep(.el-container) { min-width: 0; }
.sidebar { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; background: #f4f6f4; border-right: 1px solid var(--brand-border); overflow-x: hidden; }
.brand { height: 84px; display: flex; align-items: center; gap: 10px; padding: 0 12px; white-space: nowrap; flex-shrink: 0; }
.brand strong { font-size: 14px; font-weight: 600; }
.brand-mark { width: 40px; height: 40px; object-fit: contain; flex-shrink: 0; }
.nav, .nav-bottom { border: 0; background: transparent; }
.nav-bottom { margin-top: auto; padding-top: 12px; border-top: 1px solid var(--brand-border); }
.nav :deep(.el-menu-item), .nav-bottom :deep(.el-menu-item) { height: 44px; margin: 4px 8px; border-radius: 4px; color: var(--brand-text-soft); }
.nav :deep(.el-menu-item:hover), .nav-bottom :deep(.el-menu-item:hover) { background: #e9eeea; color: var(--brand-text); }
.nav :deep(.el-menu-item.is-active), .nav-bottom :deep(.el-menu-item.is-active) { background: #e5ede7; color: #315640; box-shadow: inset 2px 0 #43715b; font-weight: 600; }
.lead-badge :deep(.el-badge__content) { border: none; }
.header { height: 64px; display: flex; align-items: center; gap: 16px; border-bottom: 1px solid var(--brand-border); background: white; }
.header-spacer { flex: 1; }
.platform-menu-link { display: flex; align-items: center; gap: 12px; min-height: 44px; margin: 4px 8px; padding: 0 20px; border-radius: 4px; text-decoration: none; color: var(--brand-text-soft); font-size: 14px; }.platform-menu-link:hover { background: #e9eeea; color: #315640; }
.user-name { font-size: 13px; color: var(--brand-text-soft); }
.main { min-width: 0; padding: 28px; }
.main > :deep(*) { margin-right: auto; margin-left: auto; }
.loading-state { min-height: 260px; display: grid; place-items: center; color: var(--brand-text-soft); }
.sidebar-backdrop { display: none; }
@media (max-width: 640px) {
  .sidebar { position: fixed; z-index: 1000; top: 0; bottom: 0; left: 0; width: 232px !important; height: 100dvh; }
  .sidebar--hidden { transform: translateX(-100%); }
  .sidebar-backdrop { display: block; position: fixed; inset: 0; border: 0; background: rgba(34,38,37,.35); z-index: 999; }
  .header { padding: 0 12px; gap: 6px; }
  .header :deep(.el-breadcrumb) { display: none; }
  .main { padding: 20px 14px; }
}

</style>
