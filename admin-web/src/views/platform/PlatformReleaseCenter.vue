<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getPlatformOverview, planPlatformChange, executePlatformPlan, getPlatformOperation, type PlatformOverview, type PlatformRelease, type PlatformOperation } from '../../api/platform'
const state = ref<PlatformOverview | null>(null); const loading = ref(true); const error = ref(''); const pending = ref(false); const operation = ref<PlatformOperation | null>(null)
let timer: ReturnType<typeof setInterval> | undefined
const terminal = (value: string) => ['succeeded', 'failed', 'rolled_back'].includes(value)
const working = computed(() => pending.value || !!operation.value && !terminal(operation.value.status))
const date = (value: string | number) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
async function load() {
  try { state.value = await getPlatformOverview(); if (state.value.operation) operation.value = state.value.operation; error.value = '' }
  catch (e: any) { error.value = e.message || '版本信息加载失败' } finally { loading.value = false }
}
async function poll() {
  if (document.hidden) return
  if (operation.value && !terminal(operation.value.status)) {
    try { const job = await getPlatformOperation(operation.value.id); operation.value = job; if (terminal(job.status)) { await load(); if (job.status === 'succeeded') ElMessage.success('版本切换已完成') } }
    catch (e: any) { error.value = e.message || '正在重新连接版本服务' }
  } else await load()
}
async function change(release: PlatformRelease) {
  if (!state.value?.canManage || working.value) return
  pending.value = true; error.value = ''
  try {
    const type = release.sequence > state.value.current.sequence ? 'update' : 'rollback'
    const plan = await planPlatformChange(type, release.id, state.value.current.id)
    await ElMessageBox.confirm(`将从 v${plan.from.version}${type === 'update' ? '更新' : '回滚'}到 v${plan.target.version}。${plan.notice}`, '确认平台版本切换', { type: 'warning', confirmButtonText: type === 'update' ? '确认更新' : '确认回滚', cancelButtonText: '返回检查', closeOnClickModal: false })
    operation.value = await executePlatformPlan(plan)
  } catch (e: any) { if (e !== 'cancel' && e !== 'close') error.value = e.message || '版本操作未完成，请刷新检查当前状态' }
  finally { pending.value = false }
}
onMounted(() => { void load(); timer = setInterval(poll, 3000) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>
<template>
  <div class="release-shell" v-loading="loading">
    <header class="release-top"><a href="/dashboard" class="release-brand"><img src="/brand/logo.jpg" alt="唯哆鲜" />唯哆鲜 · 版本与更新</a><a href="/dashboard">返回运营台 →</a></header>
    <main>
      <div class="release-heading"><div><p class="eyebrow">平台管理</p><h1>版本与功能更新</h1><p>查看本次改进，按需切换已准备好的平台版本。</p></div><el-button :disabled="working" @click="load">检查更新</el-button></div>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="release-alert" />
      <section v-if="state" class="current-release"><div><span class="status-label">当前运行版本</span><strong>v{{ state.current.version }}</strong><p>{{ state.current.title }}</p><small>最近切换：{{ date(state.changedAt || state.current.publishedAt) }}</small></div><el-tag type="success">当前版本</el-tag></section>
      <section v-if="operation" class="operation-status" role="status"><div><strong>{{ operation.status === 'succeeded' ? '版本切换完成' : operation.status === 'rolled_back' ? '已恢复原版本' : operation.status === 'failed' ? '操作未完成' : '正在切换版本' }}</strong><el-tag :type="terminal(operation.status) ? operation.status === 'succeeded' ? 'success' : 'warning' : 'info'">{{ operation.phase === 'queued' ? '已排队' : terminal(operation.status) ? '已结束' : '处理中' }}</el-tag></div><p>{{ operation.message }}</p><small v-if="operation.backup">本次备份：{{ operation.backup }}</small><p v-if="operation.status === 'succeeded'">运营台其他页面保存工作后刷新，即可使用当前版本。</p></section>
      <p v-if="state && !state.canManage" class="release-permission">当前账号可查看更新记录；平台更新和回滚由超级管理员执行。</p>
      <div v-if="state" class="release-list">
        <article v-for="release in state.releases" :key="release.id" class="release-item"><div class="release-item-heading"><div><h2>v{{ release.version }} <span v-if="release.id === state.current.id">当前</span></h2><h3>{{ release.title }}</h3><time>{{ date(release.publishedAt) }}</time></div><el-button v-if="state.canManage && release.id !== state.current.id" :type="release.sequence > state.current.sequence ? 'primary' : 'default'" :disabled="!release.ready || working" :loading="pending" @click="change(release)">{{ !release.ready ? '尚未就绪' : release.sequence > state.current.sequence ? '更新到此版本' : '回滚到此版本' }}</el-button></div><ul><li v-for="note in release.notes" :key="note">{{ note }}</li></ul></article>
      </div>
      <p class="release-footnote">仅支持已准备并验证的版本。切换前自动备份，失败时恢复原版本；业务数据不会随版本回滚而还原。</p>
    </main>
  </div>
</template>
<style scoped>
.release-shell { min-height: 100vh; background: #f6f8f6; color: #222625; font-family: inherit; }.release-top { height: 76px; background: white; border-bottom: 1px solid #dfe5df; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 max(24px,calc((100vw - 1080px)/2)); }.release-top a { text-decoration: none; font-size: 13px; color: #315640; }.release-brand { display: flex; align-items: center; gap: 10px; font-weight: 600; }.release-brand img { width: 36px; height: 36px; object-fit: contain; }main { max-width: 1080px; margin: auto; padding: 40px 24px 64px; }.release-heading { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 28px; }.eyebrow { font-size: 12px; color: #617367; margin: 0 0 8px; }h1 { font-size: 28px; margin: 0 0 12px; }.release-heading p { color: #66716a; font-size: 14px; }.current-release,.operation-status,.release-item { background: white; border: 1px solid #dfe5df; border-radius: 8px; padding: 24px; margin-bottom: 16px; }.current-release { display: flex; align-items: flex-start; justify-content: space-between; }.status-label { display: block; font-size: 12px; color: #66716a; }.current-release strong { display: block; font-size: 32px; margin: 8px 0; font-variant-numeric: tabular-nums; }.current-release p { margin: 8px 0; }.current-release small,.operation-status small { color: #66716a; font-size: 12px; }.operation-status { border-left: 3px solid #43715b; }.operation-status>div { display: flex; justify-content: space-between; gap: 12px; }.operation-status p { font-size: 14px; line-height: 1.8; }.release-item-heading { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }h2 { font-size: 21px; margin: 0; }h2 span { margin-left: 8px; font-size: 12px; color: #43715b; }h3 { font-size: 15px; margin: 10px 0; font-weight: 500; }time { font-size: 12px; color: #66716a; }.release-item ul { padding-left: 20px; margin-bottom: 0; font-size: 14px; line-height: 1.9; }.release-permission,.release-footnote { color: #66716a; font-size: 13px; line-height: 1.8; }.release-alert { margin-bottom: 20px; }@media(max-width:640px) { .release-top { padding: 0 16px; }.release-brand { max-width: 65%; }main { padding: 24px 16px 40px; }h1 { font-size: 24px; }.release-heading,.release-item-heading { align-items: flex-start; }.release-item-heading { flex-wrap: wrap; }.current-release,.operation-status,.release-item { padding: 18px; } }
</style>
