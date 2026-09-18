<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Fold, Expand, SwitchButton } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { useAppStore } from '../stores/app'

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
  { code: 'order:read', name: '订单管理', path: '/orders', icon: 'Document' },
  { code: 'role:manage', name: '用户与角色', path: '/users', icon: 'Avatar' },
]
const bottomMenus = [
  { code: 'audit:read', name: '审计日志', path: '/audit-logs', icon: 'Clock' },
  { code: 'role:manage', name: '系统配置', path: '/system', icon: 'Setting' },
]
const menus = computed(() => localMenus.filter((item) => auth.can(item.code)))
const bottom = computed(() => bottomMenus.filter((item) => auth.can(item.code)))

onMounted(async () => {
  if (window.matchMedia('(max-width: 640px)').matches && !app.sidebarCollapsed) {
    app.toggleSidebar()
  }
  if (!auth.accessToken) return
  if (auth.profile) { profileReady.value = true; return }
  try {
    await auth.loadProfile()
    profileReady.value = true
  } catch {
    auth.reset()
    router.replace('/login')
  }
})

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
    <el-aside :width="app.sidebarCollapsed ? '64px' : '220px'" class="sidebar" :class="{ 'sidebar--hidden': app.sidebarCollapsed }">
      <div class="brand"><span class="brand-mark">锅</span><strong v-if="!app.sidebarCollapsed">火锅食材运营台</strong></div>
      <el-menu router :collapse="app.sidebarCollapsed" :default-active="route.path" class="nav" @select="handleMenuSelect">
        <el-menu-item v-for="item in menus" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.name }}</span>
        </el-menu-item>
      </el-menu>
      <div style="flex:1" />
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
        <span class="user-name">{{ auth.profile?.user.name }}</span>
        <el-button text :icon="SwitchButton" @click="handleLogout">退出</el-button>
      </el-header>
      <el-main class="main">
        <div v-if="!profileReady" class="loading-state"><span>加载中…</span></div>
        <router-view v-else />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  background: transparent;
}

.sidebar {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--brand-gradient);
  box-shadow: 12px 0 34px rgba(75, 7, 7, .16);
  transition: width .2s ease, transform .2s ease;
}

.sidebar::after {
  content: '';
  position: absolute;
  width: 280px;
  height: 280px;
  right: -190px;
  top: -150px;
  border: 3px solid rgba(255, 255, 255, .1);
  border-radius: 50%;
  pointer-events: none;
}

.brand {
  position: relative;
  z-index: 1;
  height: 72px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  color: #fff;
  white-space: nowrap;
}

.brand strong {
  font-size: 15px;
  letter-spacing: .2px;
}

.brand-mark {
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, .28);
  border-radius: 13px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, .16);
  color: #fff;
  font-size: 17px;
  font-weight: 800;
  box-shadow: 0 8px 18px rgba(49, 5, 5, .18);
}

.nav,
.nav-bottom {
  position: relative;
  z-index: 1;
  border: 0;
  background: transparent;
}

.nav-bottom {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, .1);
}

.nav :deep(.el-menu-item),
.nav-bottom :deep(.el-menu-item) {
  height: 48px;
  margin: 4px 10px;
  border-radius: 14px;
  color: rgba(255, 255, 255, .72);
  font-weight: 600;
}

.nav :deep(.el-menu-item:hover),
.nav :deep(.el-menu-item.is-active),
.nav-bottom :deep(.el-menu-item:hover),
.nav-bottom :deep(.el-menu-item.is-active) {
  background: rgba(255, 255, 255, .14);
  color: #fff;
}

.nav :deep(.el-menu-item.is-active),
.nav-bottom :deep(.el-menu-item.is-active) {
  box-shadow: inset 3px 0 0 rgba(255, 255, 255, .9);
}

.header {
  height: 68px;
  display: flex;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid rgba(141, 28, 28, .08);
  background: rgba(255, 255, 255, .84);
  backdrop-filter: blur(18px);
  box-shadow: 0 8px 24px rgba(102, 10, 10, .05);
}

.header-spacer {
  flex: 1;
}

.user-name {
  padding: 7px 12px;
  border-radius: 999px;
  background: #fff0ed;
  color: var(--brand-primary);
  font-size: 13px;
  font-weight: 700;
}

.main {
  min-width: 0;
  padding: 26px;
}

.main > :deep(*) {
  margin-right: auto;
  margin-left: auto;
}

.loading-state {
  min-height: 260px;
  border: 1px solid var(--brand-border);
  border-radius: var(--brand-radius-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, .88);
  color: var(--brand-text-soft);
  box-shadow: var(--brand-shadow-sm);
}

@media (max-width: 640px) {
  .shell > :deep(.el-container) { min-width: 0; }
  .sidebar {
    position: fixed;
    z-index: 1000;
    top: 0;
    bottom: 0;
    left: 0;
    width: 232px !important;
  }
  .sidebar--hidden { transform: translateX(-100%); }
  .header { padding: 0 8px; gap: 6px; }
  .header :deep(.el-breadcrumb) { display: none; }
  .user-name { display: none; }
  .main { padding: 14px; }
}
</style>
