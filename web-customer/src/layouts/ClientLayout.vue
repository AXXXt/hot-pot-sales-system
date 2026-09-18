<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ShoppingCart, Shop, List, User, Delete } from '@element-plus/icons-vue'
import { useAuthStore } from '../stores/auth'
import { useCartStore } from '../stores/cart'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const cart = useCartStore()

const activeMenu = computed(() => {
  if (route.path === '/' || route.path === '/home') return '/home'
  if (route.path.startsWith('/category') || route.path.startsWith('/products')) return '/category'
  if (route.path.startsWith('/order')) return '/orders'
  if (route.path.startsWith('/profile')) return '/profile'
  return route.path
})

async function handleCommand(command: string) {
  if (command === 'profile') return router.push('/profile')
  if (command === 'logout') {
    await auth.signOut()
    await router.replace('/login')
  }
}
</script>

<template>
  <div class="client-shell">
    <header class="site-header">
      <div class="header-inner">
        <router-link class="brand" to="/home">
          <span class="brand-mark">锅</span>
          <span class="brand-copy"><strong>唯多鲜食材</strong><small>B2B 采购平台</small></span>
        </router-link>
        <el-menu mode="horizontal" :default-active="activeMenu" router class="nav-menu" :ellipsis="false">
          <el-menu-item index="/home">首页</el-menu-item>
          <el-menu-item index="/category">全部商品</el-menu-item>
          <el-menu-item index="/orders">我的订单</el-menu-item>
        </el-menu>
        <div class="header-actions">
          <el-badge :value="cart.totalCount" :hidden="!cart.totalCount" :max="99">
            <el-button round :icon="ShoppingCart" @click="router.push('/cart')">进货单</el-button>
          </el-badge>
          <el-dropdown v-if="auth.isAuthenticated" @command="handleCommand">
            <button class="user-chip">{{ auth.customerName }}</button>
            <template #dropdown><el-dropdown-menu><el-dropdown-item command="profile">我的账户</el-dropdown-item><el-dropdown-item command="logout" divided>退出登录</el-dropdown-item></el-dropdown-menu></template>
          </el-dropdown>
          <el-button v-else type="primary" round @click="router.push('/login')">登录</el-button>
        </div>
      </div>
    </header>
    <main><router-view /></main>
    <footer class="site-footer">
      <div class="footer-inner">
        <div><strong>河南唯多鲜食品有限公司</strong><p>同城冷链 · 稳定供货 · 餐饮食材定制</p></div>
        <div class="footer-contact"><span>合作热线：18137222005</span><a href="https://www.baidu.com/s?wd=火锅食材B2B采购" target="_blank" rel="noopener">了解更多</a></div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.client-shell { min-height: 100vh; display: flex; flex-direction: column; }
.site-header { position: sticky; top: 0; z-index: 20; background: rgba(255,255,255,.96); border-bottom: 1px solid var(--line); backdrop-filter: blur(12px); }
.header-inner { max-width: 1180px; margin: auto; padding: 0 20px; height: 72px; display: flex; align-items: center; gap: 32px; }
.brand { display: flex; align-items: center; gap: 10px; }
.brand-mark { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; color: white; background: var(--brand-gradient); font-size: 20px; font-weight: 800; }
.brand-copy { display: flex; flex-direction: column; line-height: 1.2; }
.brand-copy small { color: var(--muted); font-size: 12px; }
.nav-menu { flex: 1; border-bottom: 0; background: transparent; }
.nav-menu :deep(.el-menu-item) { height: 72px; line-height: 72px; font-size: 15px; }
.header-actions { display: flex; align-items: center; gap: 14px; }
.user-chip { border: 0; background: transparent; cursor: pointer; font-weight: 600; max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
main { flex: 1; }
.site-footer { color: rgba(255,255,255,.78); background: #26120f; }
.footer-inner { max-width: 1180px; margin: auto; padding: 30px 20px; display: flex; justify-content: space-between; gap: 20px; }
.footer-inner p { margin: 6px 0 0; font-size: 13px; }
.footer-contact { display: flex; align-items: center; gap: 18px; }
.footer-contact a { color: #f3b8a5; }
@media (max-width: 760px) {
  .header-inner { height: auto; padding: 12px 14px; flex-wrap: wrap; gap: 12px; }
  .nav-menu { order: 3; width: 100%; flex-basis: 100%; }
  .nav-menu :deep(.el-menu-item) { height: 46px; line-height: 46px; padding: 0 16px; }
  .footer-inner { flex-direction: column; }
}
</style>