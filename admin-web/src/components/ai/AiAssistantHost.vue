<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ChatDotRound, Close, FullScreen, Minus, Plus, Picture, Rank, Refresh } from '@element-plus/icons-vue'
import { useAuthStore } from '../../stores/auth'
import * as api from '../../api/ai-assistant'
import type { AiCapabilities, AiDraft, AiMessage } from '../../api/ai-assistant'
import AiDraftCard from './AiDraftCard.vue'
import AiResultCards from './AiResultCards.vue'

const auth = useAuthStore(); const route = useRoute(); const router = useRouter()
const open = ref(false); const expanded = ref(false); const busy = ref(false); const draftBusy = ref(false)
const capability = ref<AiCapabilities | null>(null); const conversationId = ref('')
const conversations = ref<any[]>([]); const messages = ref<AiMessage[]>([]); const drafts = ref<Record<string, AiDraft>>({})
const options = ref({ brands: [], categories: [], canCreateBrand: false, canCreateCategory: false }); const input = ref(''); const progress = ref(''); const error = ref('')
const images = ref<Array<{ id: string; url: string }>>([]); const uploading = ref(false); const usePage = ref(true)
const fileInput = ref<HTMLInputElement>(); const panel = ref<HTMLElement>(); const transcript = ref<HTMLElement>(); const composer = ref<HTMLTextAreaElement>()
const position = ref<{ left: number; top: number } | null>(null)
const mobile = ref(innerWidth <= 640)
const dragDepth = ref(0)
const canAttachImages = computed(() => !!capability.value?.enabled && capability.value.tools.includes('product_draft') && capability.value.features.vision === true)
let abort: AbortController | undefined
let reminderTimer: ReturnType<typeof setInterval> | undefined
const reminderCount = ref(0)
const show = computed(() => Boolean(capability.value))
const scopeLabel = computed(() => capability.value?.scope.allBrands ? '当前租户全部品牌' : `已授权 ${capability.value?.scope.brandCount || 0} 个品牌`)
const panelStyle = computed(() => position.value ? { left: `${position.value.left}px`, top: `${position.value.top}px`, right: 'auto', bottom: 'auto' } : {})
watch([open, mobile], ([visible, narrow]) => { document.body.classList.toggle('ai-panel-mobile-open', visible && narrow); if (!visible) { dragDepth.value = 0; void nextTick(() => document.querySelector<HTMLButtonElement>('.ai-launcher')?.focus()) } })

function handleTab(event: KeyboardEvent) {
  if (!mobile.value || event.key !== 'Tab' || !panel.value) return
  const nodes = Array.from(panel.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]')).filter(x => x.offsetParent !== null)
  const first = nodes[0]; const last = nodes.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

function clearImages() { images.value.forEach(x => URL.revokeObjectURL(x.url)); images.value = [] }
async function scrollEnd() { await nextTick(); if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight }
function clearSession() { abort?.abort(); clearImages(); dragDepth.value = 0; messages.value = []; drafts.value = {}; conversationId.value = ''; conversations.value = []; capability.value = null; open.value = false; busy.value = false; error.value = ''; input.value = ''; reminderCount.value = 0 }

watch(() => auth.profile?.user.id, async owner => {
  clearSession()
  if (reminderTimer) clearInterval(reminderTimer)
  if (!owner || !(auth.can('ai:use') || auth.profile?.user.userType === 'super_admin')) return
  try {
    const result = await api.getCapabilities()
    if (auth.profile?.user.id !== owner) return
    capability.value = result
    const saved = localStorage.getItem(`ai-window:${owner}`)
    try { const parsed = saved ? JSON.parse(saved) : null; position.value = parsed && Number.isFinite(parsed.left) && Number.isFinite(parsed.top) ? parsed : null } catch { position.value = null }
    reminderTimer = setInterval(refreshReminders, 60000)
    await refreshReminders()
  } catch { capability.value = null }
}, { immediate: true })

async function refreshReminders() {
  if (!capability.value?.tools.includes('tasks_list')) return
  const owner = auth.profile?.user.id
  try { const result = await api.getAiTasks(); if (auth.profile?.user.id === owner) reminderCount.value = result.items.filter((x: any) => new Date(x.dueAt).getTime() <= Date.now()).length } catch { /* 页面继续可用 */ }
}

async function refreshCapability() { capability.value = await api.getCapabilities() }
async function loadList() { conversations.value = await api.getConversations() }
async function loadConversation(id: string) {
  if (!id || busy.value) return
  error.value = ''
  try {
    const result = await api.getConversation(id)
    conversationId.value = id; messages.value = result.messages
    drafts.value = Object.fromEntries(result.drafts.map((x: AiDraft) => [x.id, x]))
    await scrollEnd()
  } catch (e: any) { error.value = e.message || '会话不可访问'; conversationId.value = ''; messages.value = []; drafts.value = {} }
}
async function toggle() {
  open.value = !open.value
  if (!open.value) return
  try {
    await refreshCapability(); await loadList()
    if (capability.value?.tools.includes('product_draft')) options.value = await api.getCatalogOptions()
    await nextTick(); clampPosition(); composer.value?.focus()
  } catch (e: any) { error.value = e.message || '加载失败' }
}
async function freshConversation() {
  if (busy.value) return
  conversationId.value = ''; messages.value = []; drafts.value = {}; error.value = ''; input.value = ''; clearImages(); composer.value?.focus()
}
async function send(kind = 'chat', prompt?: string) {
  if (busy.value || uploading.value) return
  const text = prompt ?? input.value.trim()
  if (!text && !images.value.length) return
  const owner = auth.profile?.user.id
  busy.value = true; error.value = ''; progress.value = '正在检查权限'
  abort = new AbortController()
  try {
    if (!conversationId.value) { const created = await api.newConversation(); conversationId.value = created.id }
    const id = conversationId.value
    const attachmentIds = images.value.map(x => x.id)
    const pendingId = `pending-${Date.now()}`
    messages.value.push({ id: pendingId, role: 'user', content: text || '识别上传的包装照片' })
    input.value = ''; clearImages(); await scrollEnd()
    const result = await api.runConversation(id, { text, kind, attachmentIds, ...(usePage.value ? { page: route.path } : {}) }, abort.signal, text => { progress.value = text })
    if (auth.profile?.user.id !== owner) return
    messages.value = [...messages.value.filter(x => x.id !== pendingId), result.userMessage, result.message]
    for (const card of result.message.cards || []) if (card.type === 'draft') drafts.value[card.id] = card
    await loadList()
  } catch (e: any) {
    if (auth.profile?.user.id !== owner) return
    error.value = e.name === 'AbortError' ? '连接已中断，请查看会话历史。' : e.message || '处理失败'
    if (conversationId.value) {
      try { const state = await api.getConversation(conversationId.value); messages.value = state.messages; drafts.value = Object.fromEntries(state.drafts.map((x: AiDraft) => [x.id, x])) } catch { /* 保留可见错误 */ }
    }
  } finally { if (auth.profile?.user.id === owner) { busy.value = false; progress.value = ''; await scrollEnd() } }
}
function productPrompt() { input.value = '新增商品：品牌，分类，商品名称，包装规格，销售单位，售价，起订量。'; composer.value?.focus() }

async function attach(files: File[]) {
  if (!files.length) return
  if (!canAttachImages.value) { error.value = '当前账号没有拍照建品权限，或图片识别尚未启用。'; return }
  if (busy.value || uploading.value) { error.value = '正在处理上一项任务，请稍后再添加照片。'; return }
  if (images.value.length + files.length > 3) { error.value = '每次最多3张照片，请减少数量后重试。'; return }
  if (files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size)) { error.value = '请选择5MB以内的JPG、PNG或WebP图片。'; return }
  uploading.value = true; error.value = ''
  const owner = auth.profile?.user.id
  try {
    for (const file of files) {
      const result = await api.uploadAiImage(file)
      if (auth.profile?.user.id !== owner) return
      images.value.push({ id: result.id, url: URL.createObjectURL(file) })
    }
    await nextTick(); composer.value?.focus()
  } catch (e: any) { error.value = e.message || '上传失败' }
  finally { uploading.value = false; if (fileInput.value) fileInput.value.value = '' }
}
function pick(event: Event) { void attach(Array.from((event.target as HTMLInputElement).files || [])) }
function paste(event: ClipboardEvent) { const files = Array.from(event.clipboardData?.files || []); if (files.length) { event.preventDefault(); void attach(files) } }
function fileDrag(event: DragEvent) { return Array.from(event.dataTransfer?.types || []).includes('Files') }
function dragEnter(event: DragEvent) { if (fileDrag(event)) { event.preventDefault(); event.stopPropagation(); dragDepth.value++ } }
function dragOver(event: DragEvent) { if (fileDrag(event)) { event.preventDefault(); event.stopPropagation(); dragDepth.value = Math.max(1, dragDepth.value); if (event.dataTransfer) event.dataTransfer.dropEffect = canAttachImages.value && !busy.value && !uploading.value ? 'copy' : 'none' } }
function dragLeave(event: DragEvent) { if (fileDrag(event)) { event.preventDefault(); dragDepth.value = Math.max(0, dragDepth.value - 1) } }
function dropImages(event: DragEvent) {
  if (!fileDrag(event)) return
  event.preventDefault(); event.stopPropagation(); dragDepth.value = 0
  const files = Array.from(event.dataTransfer?.files || [])
  if (files.length) void attach(files)
  else error.value = '请拖入图片文件；网页图片可以先复制粘贴或保存后上传。'
}
function preventFileNavigation(event: DragEvent) { if (open.value && fileDrag(event)) event.preventDefault() }
function beforePlatformRefresh(event: Event) { if (input.value.trim() || images.value.length || busy.value || uploading.value || draftBusy.value) event.preventDefault() }
window.addEventListener('dragover', preventFileNavigation)
window.addEventListener('drop', preventFileNavigation)
window.addEventListener('platform:before-refresh', beforePlatformRefresh)
function removeImage(index: number) { const [image] = images.value.splice(index, 1); if (image) URL.revokeObjectURL(image.url) }

async function save(draft: AiDraft, payload: any) {
  draftBusy.value = true; error.value = ''
  try { drafts.value[draft.id] = await api.saveDraft(draft.id, draft.version, payload); ElMessage.success('草稿已保存，请检查后确认') }
  catch (e: any) { error.value = e.message || '保存失败' }
  finally { draftBusy.value = false }
}
async function confirm(draft: AiDraft) {
  const catalog = draft.action === 'product.create' ? [!draft.payload.brandId && draft.payload.brandName ? `品牌“${draft.payload.brandName}”` : '', !draft.payload.categoryId && draft.payload.categoryName ? `分类“${draft.payload.categoryName}”` : ''].filter(Boolean) : []
  const note = catalog.length ? `同时新建${catalog.join('、')}，若存在同名可用项则复用。` : ''
  try { await ElMessageBox.confirm(draft.action === 'product.create' ? `${note}将创建下架商品及所列规格，初始库存为0。确认继续？` : '将添加所列事项和北京时间提醒。确认继续？', '确认业务操作', { confirmButtonText: '确认执行', cancelButtonText: '返回检查', type: 'warning' }) }
  catch { return }
  draftBusy.value = true; error.value = ''
  try {
    const result = await api.confirmDraft(draft)
    drafts.value[draft.id] = { ...draft, status: 'succeeded' }
    const createdCatalog = [result.result.catalog?.brand?.created ? `品牌“${result.result.catalog.brand.name}”` : '', result.result.catalog?.category?.created ? `分类“${result.result.catalog.category.name}”` : ''].filter(Boolean)
    if (result.result.scopeChanged) { conversationId.value = ''; messages.value = []; drafts.value = {} }
    messages.value.push({ id: result.id, role: 'assistant', content: draft.action === 'product.create' ? `已创建：${result.result.name}（${result.result.code}），状态为下架，客户暂不可见。${createdCatalog.length ? `已同步创建${createdCatalog.join('、')}。` : ''}请到商品管理打开编辑页，核对资料后点击“上架商品”；库存需在库存管理中按实际数量入库。` : '个人提醒已添加，可在“我的事务”查看。' })
    if (draft.action === 'product.create') {
      try { await refreshCapability(); options.value = await api.getCatalogOptions(); await loadList() }
      catch { ElMessage.warning('创建已完成，品牌和分类列表刷新失败，请刷新页面。') }
    }
    await refreshReminders(); await scrollEnd()
  } catch (e: any) { error.value = e.message || '执行失败，请检查草稿与执行状态' }
  finally { draftBusy.value = false }
}
async function completeTask(id: string) { await api.updateAiTask(id, 'completed'); await refreshReminders(); await send('tasks', '查看我的事务') }

function clampPosition() {
  if (!position.value || !panel.value) return
  position.value = { left: Math.max(0, Math.min(position.value.left, innerWidth - panel.value.offsetWidth)), top: Math.max(0, Math.min(position.value.top, innerHeight - panel.value.offsetHeight)) }
}
let stopDrag: (() => void) | undefined
function drag(event: PointerEvent) {
  if (innerWidth <= 640 || !panel.value) return
  const rect = panel.value.getBoundingClientRect(); const dx = event.clientX - rect.left; const dy = event.clientY - rect.top
  const move = (e: PointerEvent) => { position.value = { left: e.clientX - dx, top: e.clientY - dy }; clampPosition() }
  const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); if (auth.profile) localStorage.setItem(`ai-window:${auth.profile.user.id}`, JSON.stringify(position.value)); stopDrag = undefined }
  stopDrag?.(); stopDrag = stop
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop, { once: true }); event.preventDefault()
}
function resetPosition() { position.value = null; expanded.value = false; if (auth.profile) localStorage.removeItem(`ai-window:${auth.profile.user.id}`) }
function handleResize() { mobile.value = innerWidth <= 640; clampPosition() }
window.addEventListener('resize', handleResize)
onBeforeUnmount(() => { abort?.abort(); clearImages(); stopDrag?.(); document.body.classList.remove('ai-panel-mobile-open'); window.removeEventListener('resize', handleResize); window.removeEventListener('dragover', preventFileNavigation); window.removeEventListener('drop', preventFileNavigation); window.removeEventListener('platform:before-refresh', beforePlatformRefresh); if (reminderTimer) clearInterval(reminderTimer) })
</script>

<template>
  <Teleport to="body">
    <button v-if="show && !open" class="ai-launcher" aria-label="打开AI运营助手" @click="toggle"><el-icon><ChatDotRound /></el-icon><span>AI 助手</span><span v-if="reminderCount" class="reminder-badge">{{ reminderCount }}</span></button>
    <section v-if="show && open" ref="panel" class="ai-panel" :class="{ 'ai-panel--expanded': expanded }" :style="panelStyle" :role="mobile ? 'dialog' : 'region'" :aria-modal="mobile || undefined" aria-label="AI运营助手" @keydown="handleTab" @keydown.esc.stop="open = false" @dragenter="dragEnter" @dragover="dragOver" @dragleave="dragLeave" @drop="dropImages">
      <div v-if="dragDepth" class="ai-drop-overlay" role="status"><strong>{{ !canAttachImages ? '当前未开放图片建品' : busy || uploading ? '正在处理，请稍后添加照片' : '松开即可添加包装照片' }}</strong><span>JPG、PNG、WebP · 最多3张 · 每张不超过5MB</span></div>
      <header class="ai-panel-header">
        <button class="drag-handle" aria-label="拖动助手窗口" @pointerdown="drag"><el-icon><Rank /></el-icon></button><strong>AI 运营助手</strong>
        <div class="ai-header-actions"><el-button text :icon="Refresh" aria-label="还原窗口位置" @click="resetPosition" /><el-button text :icon="FullScreen" aria-label="展开或缩小工作区" @click="expanded = !expanded; nextTick(clampPosition)" /><el-button text :icon="Minus" aria-label="最小化AI助手" @click="open = false" /></div>
      </header>
      <div class="ai-context"><span>{{ scopeLabel }}</span><el-button v-if="capability?.canConfigure" text size="small" @click="router.push('/ai-settings')">配置</el-button></div>
      <div v-if="!capability?.enabled" class="ai-disabled"><strong>连接模型，启用运营助手</strong><p>配置完成后，可以在这里建品、查数据和整理日常事务。</p><el-button v-if="capability?.canConfigure" type="primary" @click="router.push('/ai-settings')">前往配置</el-button><p v-else>请联系有配置权限的管理员启用。</p></div>
      <template v-else>
        <div class="conversation-toolbar"><el-select v-model="conversationId" placeholder="会话记录" size="small" :disabled="busy" @change="loadConversation"><el-option v-for="item in conversations" :key="item.id" :value="item.id" :label="item.title" /></el-select><el-button text :icon="Plus" :disabled="busy" @click="freshConversation">新会话</el-button></div>
        <div ref="transcript" class="ai-transcript" aria-live="polite" aria-relevant="additions">
          <div v-if="!messages.length" class="ai-welcome"><span class="welcome-mark"><el-icon><ChatDotRound /></el-icon></span><h2>今天需要处理什么？</h2><p>查询权限内的数据，或把录入和整理交给助手。</p></div>
          <article v-for="message in messages" :key="message.id" class="ai-message" :class="{ 'ai-message--user': message.role === 'user' }">
            <span class="speaker">{{ message.role === 'user' ? '你' : '运营助手' }}</span><p class="message-text">{{ message.content }}</p>
            <template v-for="card in message.cards || []" :key="card.id || card.title">
              <AiDraftCard v-if="card.type === 'draft'" :draft="drafts[card.id] || card as AiDraft" :options="options" :allow-execute="!!capability?.allowWrites && !!capability?.canExecute" :busy="draftBusy" @save="save" @confirm="confirm" />
              <AiResultCards v-else :cards="[card]" @complete="completeTask" />
            </template>
          </article>
          <p v-if="busy" class="ai-progress" role="status">{{ progress }}…</p>
        </div>
        <div v-if="error" class="ai-error" role="alert">{{ error }}</div>
        <div class="ai-shortcuts"><el-button size="small" :disabled="busy" @click="send('today', '整理我的今日待办')">今日待办</el-button><el-button v-if="capability?.tools.includes('product_draft')" size="small" :disabled="busy" @click="productPrompt">一句话建品</el-button><el-button v-if="capability?.tools.includes('metrics_summary')" size="small" :disabled="busy" @click="send('metrics', '查看本周经营统计')">经营统计</el-button><el-button v-if="capability?.tools.includes('tasks_list')" size="small" :disabled="busy" @click="send('tasks', '查看我的事务')">我的事务<span v-if="reminderCount"> · {{ reminderCount }}到期</span></el-button></div>
        <div class="ai-composer">
          <div v-if="images.length" class="attachment-previews"><div v-for="(image, index) in images" :key="image.id"><img :src="image.url" :alt="`待识别包装照片${index + 1}`" /><el-button text :icon="Close" :aria-label="`移除照片${index + 1}`" @click="removeImage(index)" /></div></div>
          <textarea ref="composer" v-model="input" rows="3" maxlength="4000" aria-label="向AI运营助手描述需求" placeholder="描述需求，或拖入、粘贴包装照片…" :disabled="busy" @paste="paste" @keydown.enter.exact.prevent="send()" />
          <div class="composer-actions"><div><input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="pick" /><el-button v-if="capability?.tools.includes('product_draft') && capability.features.vision" text :icon="Picture" :loading="uploading" :disabled="busy" @click="fileInput?.click()">照片</el-button><el-checkbox v-model="usePage" size="small">引用当前页</el-checkbox></div><el-button type="primary" :loading="busy" :disabled="uploading || (!input.trim() && !images.length)" @click="send()">发送</el-button></div>
          <p class="composer-note">{{ usePage ? `引用：${route.meta.title || '当前页面'}。` : '' }}业务修改需检查草稿并确认。Enter发送，Shift+Enter换行。</p>
        </div>
      </template>
    </section>
  </Teleport>
</template>

<style scoped>
.ai-launcher { position: fixed; right: 24px; bottom: 24px; z-index: 1700; display: flex; align-items: center; gap: 9px; height: 48px; padding: 0 18px; border: 1px solid #222625; border-radius: 24px; background: #222625; color: white; box-shadow: 0 6px 20px #22262522; cursor: pointer; font-weight: 600; }
.ai-launcher:focus-visible, .drag-handle:focus-visible { outline: 3px solid #43715b; outline-offset: 3px; }
.reminder-badge { min-width: 20px; padding: 2px 5px; border-radius: 12px; background: #c4461b; font-size: 11px; }
.ai-panel { position: fixed; right: 24px; bottom: 24px; z-index: 1800; width: 440px; max-width: calc(100vw - 32px); height: 680px; max-height: calc(100dvh - 48px); display: flex; flex-direction: column; overflow: hidden; background: white; border: 1px solid var(--brand-border); border-radius: 10px; box-shadow: 0 16px 56px #22262526; font-size: 14px; color: var(--brand-text); }
.ai-panel--expanded { width: 640px; }
.ai-drop-overlay { position: absolute; inset: 6px; z-index: 10; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; border: 2px dashed #43715b; border-radius: 6px; background: rgba(244,248,245,.96); color: #315640; text-align: center; pointer-events: none; }
.ai-drop-overlay span { font-size: 12px; line-height: 1.8; }
.ai-panel-header { display: flex; align-items: center; gap: 8px; min-height: 54px; padding: 0 14px 0 8px; border-bottom: 1px solid var(--brand-border); }
.drag-handle { display: grid; place-items: center; border: 0; background: transparent; color: var(--brand-text-soft); cursor: grab; width: 30px; height: 38px; touch-action: none; }
.ai-header-actions { margin-left: auto; display: flex; }
.ai-header-actions .el-button { margin: 0; width: 32px; }
.ai-context { display: flex; justify-content: space-between; align-items: center; padding: 6px 16px; color: var(--brand-text-soft); font-size: 12px; background: #f4f6f4; min-height: 32px; }
.conversation-toolbar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; }
.conversation-toolbar .el-select { min-width: 0; flex: 1; }
.ai-transcript { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 18px 18px; overscroll-behavior: contain; }
.ai-welcome { padding: 24px 0; }
.welcome-mark { display: inline-grid; place-items: center; width: 36px; height: 36px; color: #43715b; background: #e5ede7; border-radius: 6px; }
.ai-welcome h2 { font-size: 21px; margin: 16px 0 8px; }
.ai-welcome p { font-size: 13px; color: var(--brand-text-soft); line-height: 1.8; }
.ai-message { margin-bottom: 22px; }
.speaker { font-size: 11px; color: var(--brand-text-soft); }
.message-text { white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 0; line-height: 1.8; }
.ai-message--user .message-text { background: #f4f6f4; padding: 10px 12px; border-radius: 6px; }
.ai-progress { color: #43715b; font-size: 13px; }
.ai-error { margin: 0 16px 8px; padding: 10px 12px; background: #fff4ed; color: #953f19; font-size: 12px; line-height: 1.7; max-height: 100px; overflow: auto; }
.ai-shortcuts { display: flex; gap: 6px; flex-wrap: wrap; padding: 10px 16px; border-top: 1px solid var(--brand-border); }
.ai-shortcuts .el-button { margin: 0; }
.ai-composer { padding: 0 16px 12px; }
.ai-composer textarea { display: block; resize: none; width: 100%; border: 1px solid var(--brand-border); background: white; color: var(--brand-text); border-radius: 5px; padding: 10px; font-size: 16px; line-height: 1.6; }
.ai-composer textarea:focus { outline: 2px solid #43715b; outline-offset: 1px; }
.composer-actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
.composer-actions > div { display: flex; align-items: center; gap: 8px; }
.composer-note { margin: 8px 0 0; color: var(--brand-text-soft); font-size: 11px; line-height: 1.6; }
.attachment-previews { display: flex; gap: 8px; margin-bottom: 8px; }
.attachment-previews > div { position: relative; }
.attachment-previews img { display: block; width: 64px; height: 64px; object-fit: cover; border-radius: 4px; }
.attachment-previews .el-button { position: absolute; right: 0; top: 0; background: white; width: 22px; height: 22px; }
.ai-disabled { padding: 32px 24px; line-height: 1.8; }
.ai-disabled p { color: var(--brand-text-soft); font-size: 13px; }
@media(max-width:640px) { .ai-panel, .ai-panel--expanded { inset: 0 !important; width: 100% !important; max-width: none; height: 100dvh; max-height: none; border-radius: 0; padding-bottom: env(safe-area-inset-bottom); } .drag-handle { display: none; } .ai-launcher { right: 16px; bottom: 20px; } .ai-shortcuts { gap: 8px; } .composer-actions .el-button { min-height: 40px; } }
@media(prefers-reduced-motion:no-preference) { .ai-launcher { transition: box-shadow .18s ease; } .ai-launcher:hover { box-shadow: 0 8px 24px #22262544; } }
</style>

<style>
body.ai-panel-mobile-open { overflow: hidden; }
</style>
