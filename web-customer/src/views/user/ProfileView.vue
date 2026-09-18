<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../../stores/auth'
import { useCartStore } from '../../stores/cart'

const router = useRouter()
const auth = useAuthStore()
const cart = useCartStore()
const info = computed(() => [
  { label: '客户名称', value: auth.customer?.customerName || '--' },
  { label: '联系人', value: auth.customer?.contactName || '--' },
  { label: '手机号', value: auth.profile?.user.phone || '--' },
  { label: '收货地址', value: auth.customer?.address || '--' },
  { label: '可用额度', value: `¥${auth.customer?.creditRemaining || '0.00'}` },
  { label: '账号状态', value: auth.customer?.status === 'active' ? '正常' : auth.customer?.status || '--' }
])

async function signOut() {
  await auth.signOut()
  router.replace('/login')
}
</script>

<template>
  <div class="page">
    <h1 class="page-title">我的账户</h1>
    <div class="profile-grid">
      <el-card shadow="never" class="card">
        <div class="user-head">
          <div class="avatar">{{ auth.customerName.slice(0, 1) }}</div>
          <div><strong>{{ auth.customerName }}</strong><p class="muted">{{ auth.profile?.tenant.name || '火锅食材采购平台' }}</p></div>
        </div>
        <div class="quick">
          <router-link to="/orders"><el-button>我的订单</el-button></router-link>
          <router-link to="/cart"><el-button>进货单 ({{ cart.totalCount }})</el-button></router-link>
        </div>
        <el-button class="logout" size="large" @click="signOut">退出登录</el-button>
      </el-card>
      <el-card shadow="never" class="card">
        <template #header><strong>账户信息</strong></template>
        <div v-for="item in info" :key="item.label" class="info-row"><span class="muted">{{ item.label }}</span><strong>{{ item.value }}</strong></div>
      </el-card>
    </div>
  </div>
</template>

<style scoped>
.profile-grid { display: grid; grid-template-columns: 330px 1fr; gap: 16px; align-items: start; }
.card { border-radius: 16px; }
.user-head { display: flex; gap: 16px; align-items: center; margin-bottom: 22px; }
.avatar { width: 58px; height: 58px; border-radius: 18px; display: grid; place-items: center; color: white; background: var(--brand-gradient); font-size: 24px; font-weight: 700; }
.user-head p { margin: 4px 0 0; }
.quick { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.quick .el-button { width: 100%; }
.logout { width: 100%; margin-top: 14px; }
.info-row { display: flex; justify-content: space-between; gap: 20px; padding: 15px 0; border-bottom: 1px solid var(--line); }
.info-row:last-child { border-bottom: 0; }
@media (max-width: 800px) { .profile-grid { grid-template-columns: 1fr; } }
</style>