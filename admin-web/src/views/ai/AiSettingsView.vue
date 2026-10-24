<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useAuthStore } from '../../stores/auth'
import * as api from '../../api/ai-assistant'
import AiResultCards from '../../components/ai/AiResultCards.vue'

const auth = useAuthStore()
const loading = ref(true); const saving = ref(false); const testing = ref(false); const error = ref(''); const tab = ref('connection')
const hasKey = ref(false); const encryptionReady = ref(false)
const settingsLoaded = ref(false); const savedBaseUrl = ref('')
const form = reactive({ enabled: false, baseUrl: '', textModel: '', visionModel: '', apiKey: '', allowWrites: false, dailyRequests: 100,
  features: { products: true, vision: true, analytics: true, tasks: true, inventory: true, orders: true } })
const usage = ref<any[]>([]); const schedules = ref<any[]>([])
const disablingSchedule = ref<string | null>(null)
const scheduleForm = reactive({ name: '', kind: 'daily_todos', hour: 9, enabled: true })
const authorization = ref<any>({ roles: [], users: [], brands: [], permissions: [] })
const roleId = ref<number>(); const roleCodes = ref<string[]>([]); const userId = ref<number>(); const brandIds = ref<number[]>([])
const date = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '尚未运行'
const keyNeedsReplacement = computed(() => {
  if (!hasKey.value || !form.baseUrl.trim()) return false
  if (!savedBaseUrl.value) return true
  try { return new URL(form.baseUrl).hostname !== new URL(savedBaseUrl.value).hostname }
  catch { return false }
})
const keyPlaceholder = computed(() => keyNeedsReplacement.value ? '请为当前服务地址重新输入 API Key' : hasKey.value ? '已保存密钥；留空保持原值' : '输入模型API Key')

function apply(value: any) {
  for (const key of ['enabled', 'baseUrl', 'textModel', 'visionModel', 'allowWrites', 'dailyRequests'] as const) (form as any)[key] = value[key]
  form.features = { products: true, vision: true, analytics: true, tasks: true, inventory: true, orders: true, ...value.features }
  hasKey.value = value.hasKey; encryptionReady.value = value.encryptionReady; form.apiKey = ''
  savedBaseUrl.value = value.baseUrl || ''
}
async function load() {
  if (!auth.can('ai:configure')) { loading.value = false; return }
  loading.value = true; settingsLoaded.value = false; error.value = ''
  try { apply(await api.getAiSettings()); settingsLoaded.value = true } catch (e: any) { error.value = e.message || '配置加载失败' }
  finally { loading.value = false }
}
async function save() {
  if (!settingsLoaded.value || loading.value || saving.value) return
  saving.value = true; error.value = ''
  try {
    const { apiKey, ...value } = form
    apply(await api.saveAiSettings({ ...value, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) }))
    ElMessage.success('配置已保存')
  } catch (e: any) { error.value = e.message || '保存失败' }
  finally { saving.value = false }
}
async function test() {
  if (!settingsLoaded.value || loading.value || testing.value) return
  testing.value = true; error.value = ''
  try { const result = await api.testAiSettings(); ElMessage.success(result.note || '连接成功') }
  catch (e: any) { error.value = e.message || '连接测试失败' }
  finally { testing.value = false }
}
async function stop() {
  if (!settingsLoaded.value || loading.value || saving.value) return
  try { await ElMessageBox.confirm('停止新的模型请求和草稿执行，已完成的业务记录会保留。', '停用AI助手', { confirmButtonText: '停用', cancelButtonText: '取消', type: 'warning' }); form.enabled = false; await save() } catch { /* 用户取消 */ }
}
async function changeTab(name: string | number) {
  error.value = ''
  try {
    if (name === 'usage' && auth.can('ai:usage:read')) usage.value = (await api.getAiUsage()).records
    if (name === 'schedules' && auth.can('task:manage_own') && auth.can('ai:use')) schedules.value = await api.getAiSchedules()
    if (name === 'capabilities' && auth.can('role:manage')) authorization.value = await api.getAiAuthorization()
  } catch (e: any) { error.value = e.message || '数据加载失败' }
}
function selectRole() { roleCodes.value = (authorization.value.roles.find((x: any) => x.id === roleId.value)?.codes || []).filter((code: string) => authorization.value.permissions.some((p: any) => p.code === code)) }
function selectUser() { brandIds.value = [...(authorization.value.users.find((x: any) => x.id === userId.value)?.brandIds || [])] }
async function saveRole() {
  if (!roleId.value) return
  saving.value = true
  try { await api.saveAiRole(roleId.value, roleCodes.value); ElMessage.success('角色能力已更新'); await auth.loadProfile(); await changeTab('capabilities') }
  catch (e: any) { error.value = e.message || '授权失败' } finally { saving.value = false }
}
async function saveBrands() {
  if (!userId.value) return
  saving.value = true
  try { await api.saveAiBrands(userId.value, brandIds.value); ElMessage.success('品牌范围已更新'); await changeTab('capabilities') }
  catch (e: any) { error.value = e.message || '更新失败' } finally { saving.value = false }
}
async function addSchedule() {
  if (saving.value) return
  saving.value = true; error.value = ''
  try { await api.createAiSchedule(scheduleForm); schedules.value = await api.getAiSchedules(); ElMessage.success('自动任务已添加') }
  catch (e: any) { error.value = e.message || '创建失败' } finally { saving.value = false }
}
async function disable(id: string) {
  if (disablingSchedule.value) return
  disablingSchedule.value = id; error.value = ''
  try { await api.disableAiSchedule(id); schedules.value = await api.getAiSchedules() }
  catch (e: any) { error.value = e.message || '暂停失败，请重试' }
  finally { disablingSchedule.value = null }
}
async function exportReport() { try { await api.downloadAiReport(); ElMessage.success('已导出本人授权范围内的本周统计') } catch (e: any) { error.value = e.message || '导出失败' } }
onMounted(load)
</script>

<template>
  <div v-if="!auth.can('ai:configure')" class="ai-settings"><el-result icon="warning" title="没有AI配置权限" sub-title="请联系管理员分配配置权限；业务权限需分别授予。" /></div>
  <div v-else v-loading="loading" class="ai-settings">
    <div class="settings-heading"><div><p class="eyebrow">运营工具</p><h1>AI 助手配置</h1><p class="settings-subtitle">连接模型、设置业务能力，并控制可操作范围。</p></div><div class="heading-actions"><el-tag :type="form.enabled ? 'success' : 'info'">{{ form.enabled ? '已启用' : '未启用' }}</el-tag><el-button v-if="!settingsLoaded && !loading" @click="load">重试加载配置</el-button><el-button v-if="form.enabled" :disabled="!settingsLoaded || loading" @click="stop">停用助手</el-button><el-button type="primary" :loading="saving" :disabled="!settingsLoaded || loading" @click="save">保存配置</el-button></div></div>
    <el-alert v-if="error" :title="error" type="error" show-icon :closable="false" class="settings-error" />
    <el-tabs v-model="tab" @tab-change="changeTab">
      <el-tab-pane label="模型连接" name="connection">
        <section class="settings-section">
          <h2>服务连接</h2><p>模型只理解需求，实际查询和业务写入由当前账号权限控制。</p>
          <el-form :model="form" :disabled="!settingsLoaded || loading" label-position="top" class="connection-form">
            <el-form-item label="服务地址"><el-input v-model="form.baseUrl" placeholder="https://工作空间.cn-beijing.maas.aliyuncs.com/compatible-mode/v1" /><small>支持百炼批准域名与 https://api.deepseek.com/v1；视觉模型需支持图片与工具调用。</small></el-form-item>
            <div class="settings-grid"><el-form-item label="文本模型"><el-input v-model="form.textModel" placeholder="填写账户可用的模型名称" /></el-form-item><el-form-item label="视觉模型"><el-input v-model="form.visionModel" placeholder="用于包装图片识别" /></el-form-item></div>
            <el-form-item label="API Key"><el-input v-model="form.apiKey" type="password" show-password autocomplete="new-password" :placeholder="keyPlaceholder" /><small>同一供应商留空保留已保存密钥；更换供应商或恢复已清空的服务地址时，请重新输入 API Key。</small><small v-if="keyNeedsReplacement" role="status">当前服务地址需要重新输入 API Key 后保存。</small><small>密钥加密保存，不向浏览器返回明文。{{ encryptionReady ? '服务器加密配置已就绪。' : '保存密钥前需在服务器配置 AI_ENCRYPTION_KEY。' }}</small></el-form-item>
            <div class="setting-row"><div><strong>启用AI助手</strong><p>关闭后停止新模型请求与草稿执行。</p></div><el-switch v-model="form.enabled" aria-label="启用AI助手" /></div>
            <el-button :loading="testing" :disabled="!settingsLoaded || loading || !hasKey || !form.enabled" @click="test">测试已保存的文本连接</el-button>
          </el-form>
        </section>
      </el-tab-pane>
      <el-tab-pane label="能力与权限" name="capabilities">
        <section class="settings-section">
          <h2>可用能力</h2><p>能力开关决定系统开放哪些功能，人员仍需具备对应业务权限。</p>
          <div v-for="item in [{ key: 'products', title: '一句话建品', note: '生成并检查商品及规格草稿' }, { key: 'orders', title: '采购清单转订单', note: '按客户协议价和品牌拆分订单草稿' }, { key: 'vision', title: '图片识别', note: '识别商品包装、到货单及客户采购清单' }, { key: 'analytics', title: '经营统计', note: '查询当前人员可见范围的数据' }, { key: 'inventory', title: '一句话调库存', note: '核对具体规格后调整数量，保留单据与流水' }, { key: 'tasks', title: '个人事务', note: '整理待办、提醒和自动报告' }]" :key="item.key" class="setting-row"><div><strong>{{ item.title }}</strong><p>{{ item.note }}</p></div><el-switch v-model="(form.features as any)[item.key]" :aria-label="item.title" /></div>
          <div class="setting-row"><div><strong>允许确认后执行业务操作</strong><p>首版支持创建下架商品和个人提醒，仍需AI执行及业务权限。</p></div><el-switch v-model="form.allowWrites" aria-label="允许业务写入" /></div>
        </section>
        <section v-if="auth.can('role:manage')" class="settings-section">
          <h2>人员授权</h2><p>角色分配能力，人员分配品牌范围。销售仅查询负责的客户和线索；普通人员未分配品牌时无法查看品牌业务数据。</p>
          <div class="settings-grid">
            <div><el-form label-position="top"><el-form-item label="选择角色"><el-select v-model="roleId" placeholder="选择角色" @change="selectRole"><el-option v-for="role in authorization.roles" :key="role.id" :value="role.id" :label="role.name" /></el-select></el-form-item><el-checkbox-group v-model="roleCodes" class="permission-list"><el-checkbox v-for="item in authorization.permissions" :key="item.code" :value="item.code">{{ item.name }}</el-checkbox></el-checkbox-group><el-button :disabled="!roleId" :loading="saving" @click="saveRole">保存角色能力</el-button></el-form></div>
            <div><el-form label-position="top"><el-form-item label="选择人员"><el-select v-model="userId" placeholder="选择运营人员" @change="selectUser"><el-option v-for="user in authorization.users" :key="user.id" :value="user.id" :label="user.name" /></el-select></el-form-item><el-form-item label="可操作品牌"><el-select v-model="brandIds" multiple placeholder="未分配时默认无品牌范围"><el-option v-for="brand in authorization.brands" :key="brand.id" :value="brand.id" :label="brand.name" /></el-select></el-form-item><el-button :disabled="!userId" :loading="saving" @click="saveBrands">保存品牌范围</el-button></el-form></div>
          </div>
        </section>
      </el-tab-pane>
      <el-tab-pane label="业务规则" name="rules">
        <section class="settings-section"><h2>商品录入</h2><dl class="rule-list"><dt>创建状态</dt><dd>默认下架，上架需到商品管理单独处理。</dd><dt>初始库存</dt><dd>固定为0；入库通过库存管理生成单据和流水。</dd><dt>名称与编码</dt><dd>管理标签按品牌与分类生成；商品名称填写客户看到的真实名称，编码由系统分配。</dd><dt>图片</dt><dd>每次最多3张，每张5MB；识别附件私有保存7天。</dd><dt>操作确认</dt><dd>确认绑定草稿版本和内容，有效期10分钟；保存修改后重新计时。</dd></dl></section>
        <section class="settings-section"><h2>统计口径</h2><p>有效订单金额按下单时间统计待发货、已发货、已完成订单，排除样品。订单额不等于实收或利润。日期使用北京时间，商品数量按销售单位分别统计。</p><el-button v-if="auth.can('analytics:view') && auth.can('order:read') && auth.can('export:create')" @click="exportReport">导出本周经营统计</el-button></section>
      </el-tab-pane>
      <el-tab-pane label="知识与模板" name="knowledge">
        <section class="settings-section"><h2>内置操作模板</h2><p>可以在悬浮助手中复制使用，助手会按权限查询或生成待确认草稿。</p><ul class="template-list"><li>新增商品：品牌、分类、商品名称、包装规格、销售单位、售价、起订量。</li><li>上传包装正面和规格标签，识别商品信息，不清楚的字段保持空白。</li><li>把爆汁牛筋丸500克/袋库存增加10袋；或将该规格库存设为30袋。核对草稿并确认后生成流水。</li><li>整理我今天的待报价、待发货和客户跟进事项。</li><li>明天下午3点提醒我跟进指定事项。</li><li>分析本周有效订单金额，列出商品排名和统计口径。</li><li>检查哪些商品缺少主图或规格。</li></ul><p>财务审批、退款、授信和角色变更通过原业务页面处理。</p></section>
      </el-tab-pane>
      <el-tab-pane label="自动任务" name="schedules">
        <section v-if="auth.can('task:manage_own') && auth.can('ai:use')" class="settings-section">
          <h2>我的自动任务</h2><p>自动生成站内报告，不自动修改商品、库存或订单，也不发送微信提醒。每个账号最多启用10个任务。账号或权限变化时任务暂停；生成中断后会自动恢复。</p>
          <el-form label-position="top"><div class="settings-grid"><el-form-item label="任务名称"><el-input v-model="scheduleForm.name" maxlength="100" placeholder="例如：每日工作清单" /></el-form-item><el-form-item label="任务类型"><el-select v-model="scheduleForm.kind"><el-option label="每天汇总我的待办" value="daily_todos" /><el-option v-if="auth.can('analytics:view') && auth.can('order:read')" label="每周一生成经营报告" value="weekly_metrics" /></el-select></el-form-item></div><el-form-item label="运行时刻（北京时间整点）"><el-input-number v-model="scheduleForm.hour" :min="0" :max="23" /></el-form-item><el-button type="primary" :loading="saving" @click="addSchedule">添加任务</el-button></el-form>
          <div v-for="item in schedules" :key="item.id" class="schedule-item"><div class="setting-row"><div><strong>{{ item.name }}</strong><p>{{ item.running ? '报告正在生成，中断后会自动恢复' : item.enabled ? `下次：${date(item.nextRunAt)}` : '已暂停' }} · 最近：{{ date(item.lastRunAt) }}</p><p v-if="item.error">{{ item.error }}</p></div><el-button v-if="item.enabled" :loading="disablingSchedule === item.id" @click="disable(item.id)">暂停</el-button></div><AiResultCards v-if="item.lastResult" readonly :cards="Array.isArray(item.lastResult) ? item.lastResult : [item.lastResult]" /></div>
        </section><p v-else class="settings-subtitle">需要使用AI和管理个人事务的权限。</p>
      </el-tab-pane>
      <el-tab-pane label="用量与审计" name="usage">
        <section class="settings-section"><h2>调用上限</h2><p>按人员限制每天的模型请求次数，查询快捷入口不消耗模型调用。失败的模型尝试也计入次数。</p><el-form label-position="top"><el-form-item label="每人每天最多模型请求数"><el-input-number v-model="form.dailyRequests" :min="1" :max="10000" /></el-form-item></el-form><p>Token使用量供核对，实际费用以供应商账单为准。业务执行记录保存在审计日志中。</p><el-button v-if="auth.can('audit:read')" @click="$router.push('/audit-logs')">查看业务审计日志</el-button></section>
        <section v-if="auth.can('ai:usage:read')" class="settings-section"><h2>本人最近100次模型调用</h2><el-table :data="usage" empty-text="暂无调用记录"><el-table-column prop="model" label="模型" min-width="150" /><el-table-column label="时间" min-width="180"><template #default="{ row }">{{ date(row.createdAt) }}</template></el-table-column><el-table-column prop="inputTokens" label="输入Token" width="100" /><el-table-column prop="outputTokens" label="输出Token" width="100" /><el-table-column prop="images" label="图片数" width="80" /><el-table-column prop="status" label="状态" width="100" /></el-table></section>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.ai-settings { width: 100%; max-width: 1200px; }
.settings-heading { display: flex; justify-content: space-between; gap: 24px; align-items: center; margin-bottom: 24px; }
.eyebrow { color: #43715b; font-size: 12px; margin: 0 0 8px; }
h1 { font-size: 28px; margin: 0; } h2 { font-size: 18px; margin: 0 0 12px; }
.settings-subtitle, .settings-section p, .settings-section small { color: var(--brand-text-soft); font-size: 13px; line-height: 1.9; }
.settings-subtitle { margin: 10px 0 0; }
.heading-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.heading-actions .el-button { margin: 0; }
.settings-error { margin-bottom: 16px; }
.settings-section { padding: 24px 0; border-bottom: 1px solid var(--brand-border); }
.connection-form { max-width: 760px; margin-top: 22px; }
.settings-section small { display: block; width: 100%; margin-top: 6px; }
.settings-grid { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 24px; }
.setting-row { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 16px 0; }
.setting-row p { margin: 4px 0 0; }
.setting-row .el-switch { flex-shrink: 0; }
.rule-list { display: grid; grid-template-columns: 110px minmax(0,1fr); gap: 16px; line-height: 1.8; font-size: 14px; }
.rule-list dt { font-weight: 600; } .rule-list dd { margin: 0; color: var(--brand-text-soft); }
.template-list { padding-left: 20px; line-height: 2.5; font-size: 14px; }
.permission-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
.schedule-item { border-top: 1px solid var(--brand-border); margin-top: 24px; padding-bottom: 20px; }
@media(max-width:760px) { .settings-heading { flex-direction: column; align-items: flex-start; } .settings-grid { grid-template-columns: minmax(0,1fr); gap: 0; } .rule-list { grid-template-columns: minmax(0,1fr); gap: 8px; } .rule-list dd { margin-bottom: 12px; } }
</style>
