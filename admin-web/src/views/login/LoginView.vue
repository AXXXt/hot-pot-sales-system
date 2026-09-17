<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { sendCode } from '../../api/auth'
import { useAuthStore } from '../../stores/auth'

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

async function handleSendCode() {
  try {
    await formRef.value?.validateField('phone')
    sending.value = true
    await sendCode(form.phone)
    ElMessage.success('验证码已发送')
    seconds.value = 60
    const timer = window.setInterval(() => {
      seconds.value -= 1
      if (seconds.value <= 0) window.clearInterval(timer)
    }, 1000)
  } catch {
    // 请求层统一展示服务端错误，表单校验错误由表单项展示。
  } finally {
    sending.value = false
  }
}

async function handleLogin() {
  try {
    if (!await formRef.value?.validate()) return
    await auth.signIn(form.phone, form.code)
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/dashboard'
    await router.replace(redirect)
  } catch {
    // 防止请求失败形成未处理的事件 Promise，错误信息由请求层统一展示。
  }
}
</script>

<template>
  <main class="login-page">
    <section class="login-panel">
      <div class="login-intro">
        <div class="logo">锅</div>
        <span class="login-kicker">食品供应链</span>
        <h1>火锅食材运营台</h1>
        <p>统一管理商品、客户、订单与履约进度</p>
        <div class="intro-tags"><span>采购管理</span><span>订单协同</span><span>库存预警</span></div>
      </div>
      <div class="login-form-card">
        <div class="form-heading"><h2>管理员登录</h2><p>使用已授权手机号完成身份验证</p></div>
        <el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="handleLogin">
          <el-form-item label="手机号" prop="phone"><el-input v-model="form.phone" maxlength="11" placeholder="请输入管理员手机号" /></el-form-item>
          <el-form-item label="验证码" prop="code">
            <div class="code-row"><el-input v-model="form.code" maxlength="6" placeholder="请输入验证码" /><el-button :disabled="seconds > 0" :loading="sending" @click="handleSendCode">{{ seconds ? `${seconds}秒` : '获取验证码' }}</el-button></div>
          </el-form-item>
          <el-button native-type="submit" type="primary" :loading="auth.loading" class="submit">登录</el-button>
        </el-form>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  padding: 32px;
  display: grid;
  place-items: center;
  background: var(--brand-soft-gradient);
}

.login-page::before,
.login-page::after {
  content: '';
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
}

.login-page::before {
  width: 520px;
  height: 520px;
  top: -310px;
  right: -190px;
  border: 7px solid rgba(255, 255, 255, .18);
}

.login-page::after {
  width: 360px;
  height: 360px;
  bottom: -230px;
  left: -160px;
  background: rgba(102, 10, 10, .12);
}

.login-panel {
  position: relative;
  z-index: 1;
  width: min(900px, 100%);
  min-height: 520px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .58);
  border-radius: 30px;
  display: grid;
  grid-template-columns: .95fr 1.05fr;
  background: rgba(255, 255, 255, .94);
  box-shadow: 0 30px 80px rgba(75, 7, 7, .22);
}

.login-intro {
  position: relative;
  overflow: hidden;
  padding: 58px 46px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  background: var(--brand-gradient);
  color: #fff;
}

.login-intro::after {
  content: '';
  position: absolute;
  width: 330px;
  height: 330px;
  right: -210px;
  bottom: -150px;
  border: 4px solid rgba(255, 255, 255, .1);
  border-radius: 50%;
}

.logo {
  width: 54px;
  height: 54px;
  margin-bottom: 34px;
  border: 1px solid rgba(255, 255, 255, .3);
  border-radius: 18px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, .16);
  color: #fff;
  font-size: 22px;
  font-weight: 800;
  box-shadow: 0 12px 28px rgba(49, 5, 5, .2);
}

.login-kicker {
  margin-bottom: 12px;
  color: rgba(255, 255, 255, .68);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2px;
}

.login-intro h1 {
  margin: 0 0 14px;
  color: #fff;
  font-size: 32px;
  line-height: 1.25;
}

.login-intro p {
  max-width: 300px;
  margin: 0;
  color: rgba(255, 255, 255, .72);
  font-size: 14px;
  line-height: 1.75;
}

.intro-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 34px;
}

.intro-tags span {
  padding: 7px 11px;
  border: 1px solid rgba(255, 255, 255, .16);
  border-radius: 999px;
  background: rgba(255, 255, 255, .1);
  color: rgba(255, 255, 255, .86);
  font-size: 12px;
}

.login-form-card {
  padding: 62px 54px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.form-heading {
  margin-bottom: 30px;
}

.form-heading h2 {
  margin: 0 0 8px;
  color: var(--brand-text);
  font-size: 25px;
}

.form-heading p {
  margin: 0;
  color: var(--brand-text-soft);
  font-size: 13px;
}

.code-row {
  width: 100%;
  display: grid;
  grid-template-columns: 1fr 124px;
  gap: 10px;
}

.submit {
  width: 100%;
  min-height: 44px;
  margin-top: 8px;
}

@media (max-width: 760px) {
  .login-page { padding: 18px; }
  .login-panel { max-width: 460px; grid-template-columns: 1fr; }
  .login-intro { min-height: 220px; padding: 34px; }
  .logo { margin-bottom: 22px; }
  .intro-tags { margin-top: 22px; }
  .login-form-card { padding: 38px 30px; }
}

@media (max-width: 430px) {
  .code-row { grid-template-columns: 1fr; }
}
</style>
