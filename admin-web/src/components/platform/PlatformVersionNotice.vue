<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { ElMessageBox, ElNotification } from 'element-plus'
import { useAuthStore } from '../../stores/auth'
import { BROWSER_RELEASE, BROWSER_VERSION, getPlatformOverview, type PlatformOverview } from '../../api/platform'
const auth = useAuthStore()
const state = ref<PlatformOverview | null>(null); const open = ref(false); const unseen = ref(false)
const different = computed(() => !!state.value && BROWSER_RELEASE !== 'development' && state.value.current.id !== BROWSER_RELEASE)
const version = computed(() => state.value?.current.version || BROWSER_VERSION)
let timer: ReturnType<typeof setInterval> | undefined
let notice: ReturnType<typeof ElNotification> | undefined
function seenKey() { return `platform-seen:${auth.profile?.user.id}` }
function view() { open.value = true; if (state.value) localStorage.setItem(seenKey(), state.value.current.id); unseen.value = false; notice?.close() }
async function refresh() {
  if (document.hidden) return
  try {
    const value = await getPlatformOverview()
    if (!value?.current?.id) return
    const changed = state.value?.current.id !== value.current.id
    state.value = value
    unseen.value = localStorage.getItem(seenKey()) !== value.current.id
    if (changed && unseen.value) { notice?.close(); notice = ElNotification({ title: `平台已更新至 v${value.current.version}`, message: `${value.current.title}。点击查看更新说明。`, type: 'info', duration: 8000, onClick: view }) }
  } catch { /* 版本检查不打断正在进行的业务 */ }
}
async function reload() {
  const event = new Event('platform:before-refresh', { cancelable: true }); window.dispatchEvent(event)
  try { await ElMessageBox.confirm(event.defaultPrevented ? 'AI助手中有尚未发送的内容或正在处理的任务。请先保存；确认刷新将重新加载页面。' : '刷新将重新加载页面，请确认正在编辑的内容已经保存。', '刷新当前页面', { confirmButtonText: '确认刷新', cancelButtonText: '继续当前工作' }); location.reload() } catch { /* 保留当前页面 */ }
}
onMounted(() => { void refresh(); timer = setInterval(refresh, 60000); document.addEventListener('visibilitychange', refresh) })
onBeforeUnmount(() => { if (timer) clearInterval(timer); notice?.close(); document.removeEventListener('visibilitychange', refresh) })
</script>
<template>
  <el-button class="platform-version" text aria-label="查看平台版本与更新" @click="view"><span v-if="unseen" class="version-dot" />{{ version === '开发版' ? version : `v${version}` }}</el-button>
  <el-dialog v-model="open" title="平台版本与功能更新" width="540px" append-to-body>
    <template v-if="state"><p class="release-version">v{{ state.current.version }}</p><h3>{{ state.current.title }}</h3><p class="release-date">{{ new Date(state.current.publishedAt).toLocaleDateString('zh-CN') }}</p><ul class="release-notes"><li v-for="note in state.current.notes" :key="note">{{ note }}</li></ul><el-alert v-if="different" title="平台版本已切换，保存当前工作后刷新页面即可使用当前版本。" type="info" :closable="false" /></template>
    <p v-else>版本信息暂不可用，可稍后在版本中心查看。</p>
    <template #footer><a class="version-center-link" href="/platform-updates" target="_blank" rel="noopener">打开版本与更新中心 ↗</a><el-button v-if="different" type="primary" @click="reload">保存后刷新</el-button><el-button v-else @click="open = false">知道了</el-button></template>
  </el-dialog>
</template>
<style scoped>
.platform-version { color: var(--brand-text-soft); font-variant-numeric: tabular-nums; }
.version-dot { width: 6px; height: 6px; border-radius: 50%; background: #43715b; display: inline-block; margin-right: 6px; }
.release-version { color: #315640; font-size: 24px; font-weight: 600; margin: 0; }
.release-date { color: var(--brand-text-soft); font-size: 12px; }.release-notes { padding-left: 20px; line-height: 1.9; }.version-center-link { color: #315640; margin-right: 16px; }
</style>
