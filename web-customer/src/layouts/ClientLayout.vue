<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ShoppingCart, ArrowDown } from "@element-plus/icons-vue";
import { useAuthStore } from "../stores/auth";
import { useCartStore } from "../stores/cart";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const cart = useCartStore();

const activeMenu = computed(() => {
  if (route.path === "/" || route.path === "/home") return "/home";
  if (route.path.startsWith("/category") || route.path.startsWith("/products"))
    return "/category";
  if (route.path.startsWith("/order")) return "/orders";
  if (route.path.startsWith("/profile")) return "/profile";
  return route.path;
});

async function handleCommand(command: string) {
  if (command === "profile") return router.push("/profile");
  if (command === "logout") {
    await auth.signOut();
    await router.replace("/login");
  }
}
async function retryProfile() {
  try { await auth.loadProfile() } catch { /* 保留账户资料错误和重试入口。 */ }
}
</script>

<template>
  <div class="client-shell">
    <header class="site-header">
      <div class="header-inner">
        <router-link class="brand" to="/home">
          <span class="brand-logo"
            ><img src="/brand/logo.jpg" alt="唯哆鲜，唯新鲜 才健康"
          /></span>
        </router-link>
        <el-menu
          mode="horizontal"
          :default-active="activeMenu"
          router
          class="nav-menu"
          :ellipsis="false"
        >
          <el-menu-item index="/home">首页</el-menu-item>
          <el-menu-item index="/category">食材目录</el-menu-item>
          <el-menu-item index="/orders">我的订单</el-menu-item>
        </el-menu>
        <div class="header-actions">
          <el-badge
            :value="cart.totalCount"
            :hidden="!cart.totalCount"
            :max="99"
          >
            <el-button
              text
              class="cart-entry"
              :icon="ShoppingCart"
              aria-label="进货单"
              title="进货单"
              @click="router.push('/cart')"
            />
          </el-badge>
          <el-dropdown v-if="auth.isAuthenticated" @command="handleCommand">
            <button class="user-chip">
              {{ auth.customerName }} <el-icon><ArrowDown /></el-icon>
            </button>
            <template #dropdown
              ><el-dropdown-menu
                ><el-dropdown-item command="profile">我的账户</el-dropdown-item
                ><el-dropdown-item command="logout" divided
                  >退出登录</el-dropdown-item
                ></el-dropdown-menu
              ></template
            >
          </el-dropdown>
          <el-button v-else type="primary" @click="router.push('/login')"
            >登录</el-button
          >
        </div>
      </div>
    </header>
    <main>
      <el-alert v-if="auth.profileLoading" title="正在更新账户资料" type="info" :closable="false" />
      <el-alert v-else-if="auth.profileError" :title="auth.profileError" type="error" :closable="false"><el-button @click="retryProfile">重试账户资料</el-button></el-alert>
      <router-view v-else />
    </main>
    <footer class="site-footer">
      <div class="footer-inner">
        <div>
          <strong>河南唯哆鲜食品有限公司</strong>
          <p>同城冷链 · 稳定供货 · 餐饮食材定制</p>
        </div>
        <div class="footer-contact">
          <span>合作热线：13937802005</span
          ><a href="https://weiduoxian.cn" target="_blank" rel="noopener"
            >了解更多</a
          >
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.client-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.site-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: white;
  border-bottom: 1px solid var(--line);
}
.header-inner {
  max-width: 1600px;
  margin: auto;
  padding: 0 40px;
  height: 88px;
  display: flex;
  align-items: center;
  gap: 60px;
}
.brand {
  display: flex;
  flex-shrink: 0;
}
.brand-logo {
  width: 130px;
  height: 80px;
  overflow: hidden;
  display: block;
}
.brand-logo img {
  width: 130px;
  height: 130px;
  transform: translateY(-24px);
}
.nav-menu {
  flex: 1;
  border-bottom: 0;
  background: transparent;
  --el-menu-horizontal-height: 88px;
}
.nav-menu :deep(.el-menu-item) {
  height: 88px;
  line-height: 88px;
  font-size: 14px;
  padding: 0 20px;
}
.nav-menu :deep(.el-menu-item.is-active) {
  color: var(--ink) !important;
  border-bottom-color: var(--ink);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 20px;
}
.cart-entry {
  width: 44px;
  height: 44px;
  font-size: 21px;
}
.user-chip {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: none;
  cursor: pointer;
  min-height: 44px;
  max-width: 150px;
  overflow-wrap: anywhere;
  color: var(--ink);
  font-size: 13px;
}
main {
  flex: 1;
}
.site-footer {
  color: var(--muted);
  border-top: 1px solid var(--line);
  background: white;
}
.footer-inner {
  max-width: 1520px;
  margin: auto;
  padding: 30px 40px;
  display: flex;
  justify-content: space-between;
  gap: 20px;
}
.footer-inner strong {
  font-size: 13px;
  font-weight: 500;
}
.footer-inner p {
  margin: 8px 0 0;
  font-size: 12px;
}
.footer-contact {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 12px;
}
@media (max-width: 760px) {
  .header-inner {
    height: auto;
    padding: 0 20px;
    flex-wrap: wrap;
    gap: 0;
    justify-content: space-between;
  }
  .brand-logo {
    width: 100px;
    height: 68px;
  }
  .brand-logo img {
    width: 100px;
    height: 100px;
    transform: translateY(-15px);
  }
  .nav-menu {
    order: 3;
    width: 100%;
    flex-basis: 100%;
    --el-menu-horizontal-height: 44px;
  }
  .nav-menu :deep(.el-menu-item) {
    height: 44px;
    line-height: 44px;
    padding: 0 20px;
  }
  .header-actions {
    gap: 8px;
  }
  .user-chip {
    max-width: 108px;
    font-size: 12px;
  }
  .footer-inner {
    flex-direction: column;
    padding: 24px 20px;
  }
  .footer-contact {
    flex-wrap: wrap;
  }
}
</style>
