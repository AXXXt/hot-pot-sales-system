<script setup lang="ts">
import { onUnmounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import * as authApi from '../api/auth'
import { useAuthStore } from '../stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const formRef = ref<FormInstance>()
const sending = ref(false)
const seconds = ref(0)
const form = reactive({ phone: '', code: '' })
const rules: FormRules = {
  phone: [{ required: true, pattern: /^1\d{10}$/, message: '请输入有效手机号', trigger: 'blur' }],
  code: [{ required: true, message: '请输入验证码', trigger: 'blur' }]
}
let timer = 0

async function handleSendCode() {
  await formRef.value?.validateField('phone').catch(() => Promise.reject())
  sending.value = true
  try {
    await authApi.sendCode(form.phone)
    ElMessage.success('验证码已发送')
    seconds.value = 60
    timer = window.setInterval(() => {
      seconds.value -= 1
      if (seconds.value <= 0) window.clearInterval(timer)
    }, 1000)
  } finally {
    sending.value = false
  }
}

async function handleLogin() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  try {
    await auth.signIn(form.phone, form.code)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/home'
    await router.replace(redirect)
  } catch (error: any) {
    if (!error?.handled) ElMessage.error(error?.message || '登录失败，请确认账号已通过审核')
  }
}

onUnmounted(() => window.clearInterval(timer))
</script>

<template>
  <main class="login-page">
    <section class="login-panel">
      <aside>
        <div class="logo">锅</div>
        <small>B2B FOOD SUPPLY</small>
        <h1>火锅食材<br />PC 采购工作台</h1>
        <p>大批量进货、协议价透明、订单进度可追踪，支持一键复购。</p>
        <div class="feature-tags"><span>同城配送</span><span>整箱批发</span><span>账期协同</span></div>
      </aside>
      <div class="form-area">
        <h2>客户登录</h2>
        <p class="muted">使用已审核通过的采购账号手机号登录</p>
        <el-form ref="formRef" :model="form" :rules="rules" size="large" label-position="top" @submit.prevent="handleLogin">
          <el-form-item label="手机号" prop="phone">
            <el-input v-model="form.phone" maxlength="11" placeholder="请输入手机号" />
          </el-form-item>
          <el-form-item label="短信验证码" prop="code">
            <div class="code-row">
              <el-input v-model="form.code" maxlength="6" placeholder="请输入验证码" />
              <el-button :disabled="seconds > 0" :loading="sending" @click="handleSendCode">
                {{ seconds ? `${seconds}秒` : '获取验证码' }}
              </el-button>
            </div>
          </el-form-item>
          <el-button native-type="submit" type="primary" size="large" class="login-submit" :loading="auth.loading">登录采购台</el-button>
          <p class="login-tip">未开通账号？请联系合作热线 18137222005</p>
        </el-form>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page { min-height: 100vh; display: grid; place-items: center; padding: 30px; background: radial-gradient(circle at top right, #ffd6cb, transparent 36%), linear-gradient(135deg,#f8efed,#f2ded8); }
.login-panel { width: min(880px,100%); min-height: 500px; display: grid; grid-template-columns: .9fr 1.1fr; overflow: hidden; border-radius: 26px; background: white; box-shadow: 0 24px 70px rgba(91,16,16,.18); }
aside { color: white; padding: 52px 42px; background: var(--brand-gradient); }
.logo { width: 52px; height: 52px; margin-bottom: 36px; display: grid; place-items: center; border: 1px solid rgba(255,255,255,.22); border-radius: 16px; font-size: 22px; font-weight: 800; }
small { opacity: .68; letter-spacing: 2px; font-size: 12px; }
h1 { margin: 10px 0 16px; font-size: 32px; line-height: 1.25; }
p { line-height: 1.8; }
aside p { color: rgba(255,255,255,.72); }
.feature-tags { margin-top: 40px; display: flex; gap: 8px; flex-wrap: wrap; }
.feature-tags span { padding: 6px 10px; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; background: rgba(255,255,255,.12); font-size: 12px; }
.form-area { padding: 54px 56px; }
h2 { margin: 0 0 6px; color: var(--brand); font-size: 26px; }
.code-row { display: grid; grid-template-columns: 1fr 120px; gap: 10px; width: 100%; }
.login-submit { width: 100%; margin-top: 4px; }
.login-tip { margin: 18px 0 0; color: var(--muted); font-size: 13px; }
@media (max-width: 760px) { .login-panel { grid-template-columns: 1fr; } aside { display: none; } .form-area { padding: 40px 26px; } }
</style>