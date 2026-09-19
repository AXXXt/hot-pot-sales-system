<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Refresh, Search } from '@element-plus/icons-vue'
import PageTable from '../../components/PageTable.vue'
import { getLeads, getLeadDetail, updateLead, createFollowUp, getLeadAssignees } from '../../api/lead'

const loading = ref(false)
const error = ref('')
const rows = ref<any[]>([])
const total = ref(0)
const assignees = ref<any[]>([])
const query = reactive({ status: 'all', keyword: '', assignedToId: null as number | null, page: 1, pageSize: 15 })

const statusMap: Record<string, { text: string; type: 'primary' | 'warning' | 'success' | 'info' }> = {
  new: { text: '新线索', type: 'primary' },
  contacted: { text: '已联系', type: 'warning' },
  converted: { text: '已转化', type: 'success' },
  invalid: { text: '无效', type: 'info' },
}
const statusOptions = Object.entries(statusMap).map(([value, v]) => ({ label: v.text, value }))

const dataOf = (r: any) => r?.data ?? r ?? {}
const fmtTime = (v?: string) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—'
const statusMeta = (s: string) => statusMap[s] || { text: s || '—', type: 'info' as const }

async function load() {
  loading.value = true; error.value = ''
  try {
    const params: any = { page: query.page, pageSize: query.pageSize }
    if (query.status !== 'all') params.status = query.status
    if (query.keyword.trim()) params.keyword = query.keyword.trim()
    if (query.assignedToId) params.assignedToId = query.assignedToId
    const res: any = await getLeads(params)
    const d = dataOf(res)
    rows.value = d.items || []
    total.value = d.total || 0
  } catch (e: any) { error.value = e.message || '加载失败' }
  finally { loading.value = false }
}

async function loadAssignees() {
  try {
    const res: any = await getLeadAssignees()
    assignees.value = dataOf(res) || []
  } catch { assignees.value = [] }
}

function search() { query.page = 1; load() }

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<any>(null)

async function openDetail(row: any) {
  detailVisible.value = true
  detailLoading.value = true
  detail.value = null
  try {
    const res: any = await getLeadDetail(row.id)
    detail.value = dataOf(res)
  } catch (e: any) {
    ElMessage.warning(e.message || '加载详情失败')
  } finally { detailLoading.value = false }
}

async function changeStatus(row: any, status: string) {
  try {
    await updateLead(row.id, { status })
    ElMessage.success(`已标记为「${statusMeta(status).text}」`)
    if (detail.value?.id === row.id) detail.value.status = status
    await load()
  } catch (e: any) { ElMessage.warning(e.message || '操作失败') }
}

async function assign(row: any, assignedToId: number | null) {
  if (!assignedToId) return
  try {
    await updateLead(row.id, { assignedToId })
    ElMessage.success('已分配跟进人')
    if (detail.value?.id === row.id) detail.value.assignedTo = assignees.value.find((a) => a.id === assignedToId) || null
    await load()
  } catch (e: any) { ElMessage.warning(e.message || '分配失败') }
}

const followUpVisible = ref(false)
const followUpSaving = ref(false)
const followUpForm = reactive({ leadId: 0, phone: '', content: '', nextFollowUpAt: '' })

function openFollowUp(row: any) {
  followUpForm.leadId = row.id
  followUpForm.phone = row.phone
  followUpForm.content = ''
  followUpForm.nextFollowUpAt = ''
  followUpVisible.value = true
}

async function submitFollowUp() {
  if (!followUpForm.content.trim()) {
    ElMessage.warning('请填写跟进内容')
    return
  }
  followUpSaving.value = true
  try {
    await createFollowUp(followUpForm.leadId, {
      content: followUpForm.content.trim(),
      nextFollowUpAt: followUpForm.nextFollowUpAt || undefined
    })
    ElMessage.success('跟进记录已保存')
    followUpVisible.value = false
    if (detail.value?.id === followUpForm.leadId) await openDetail({ id: followUpForm.leadId })
    await load()
  } catch (e: any) { ElMessage.warning(e.message || '保存失败') }
  finally { followUpSaving.value = false }
}

onMounted(() => { load(); loadAssignees() })
</script>

<template>
  <section>
    <div class="page-heading">
      <div><h1>获客线索</h1><p>官网留资跟进：新线索 → 已联系 → 已转化 / 无效</p></div>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
    </div>

    <div class="search-bar">
      <el-select v-model="query.status" style="width:120px" @change="search">
        <el-option label="全部状态" value="all" />
        <el-option v-for="o in statusOptions" :key="o.value" :label="o.label" :value="o.value" />
      </el-select>
      <el-select v-model="query.assignedToId" placeholder="全部跟进人" clearable style="width:150px;margin-left:10px" @change="search">
        <el-option v-for="a in assignees" :key="a.id" :label="a.name" :value="a.id" />
      </el-select>
      <el-input v-model="query.keyword" placeholder="搜索手机号 / 称呼 / 门店" clearable style="width:240px;margin-left:10px" @clear="search" @keyup.enter="search">
        <template #prefix><el-icon><Search /></el-icon></template>
      </el-input>
    </div>

    <PageTable :loading="loading" :error="error" :empty="!rows.length" @retry="load">
      <el-table :data="rows" class="click-table" @row-click="openDetail">
        <el-table-column label="手机号" min-width="130">
          <template #default="{ row }"><b>{{ row.phone }}</b></template>
        </el-table-column>
        <el-table-column label="称呼" min-width="90">
          <template #default="{ row }">{{ row.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="门店" min-width="140">
          <template #default="{ row }">{{ row.storeName || '—' }}</template>
        </el-table-column>
        <el-table-column label="规模" width="90">
          <template #default="{ row }">{{ row.storeScale || '—' }}</template>
        </el-table-column>
        <el-table-column label="意向" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">{{ row.interestedItems || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusMeta(row.status).type" size="small">{{ statusMeta(row.status).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="跟进人" width="110">
          <template #default="{ row }">{{ row.assignedTo?.name || '未分配' }}</template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click.stop="openFollowUp(row)">跟进</el-button>
            <el-button v-if="row.status !== 'converted'" size="small" type="success" plain @click.stop="changeStatus(row, 'converted')">转化</el-button>
            <el-button v-if="row.status !== 'invalid'" size="small" type="info" plain @click.stop="changeStatus(row, 'invalid')">无效</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          :page-size="query.pageSize"
          :total="total"
          layout="prev, pager, next, total"
          @current-change="load"
        />
      </div>
    </PageTable>

    <el-drawer v-model="detailVisible" title="线索详情" size="460px">
      <div v-if="detailLoading" class="inline-loading">加载中…</div>
      <template v-else-if="detail">
        <div class="detail-head">
          <div class="detail-phone">{{ detail.phone }}</div>
          <el-tag :type="statusMeta(detail.status).type">{{ statusMeta(detail.status).text }}</el-tag>
        </div>
        <el-descriptions :column="1" border size="small" class="detail-desc">
          <el-descriptions-item label="称呼">{{ detail.name || '—' }}</el-descriptions-item>
          <el-descriptions-item label="门店">{{ detail.storeName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="规模">{{ detail.storeScale || '—' }}</el-descriptions-item>
          <el-descriptions-item label="意向商品">{{ detail.interestedItems || '—' }}</el-descriptions-item>
          <el-descriptions-item label="备注">{{ detail.remark || '—' }}</el-descriptions-item>
          <el-descriptions-item label="跟进人">
            <el-select :model-value="detail.assignedTo?.id" placeholder="分配跟进人" size="small" style="width:160px" @change="(v: number) => assign(detail, v)">
              <el-option v-for="a in assignees" :key="a.id" :label="a.name" :value="a.id" />
            </el-select>
          </el-descriptions-item>
          <el-descriptions-item label="下次跟进">{{ fmtTime(detail.nextFollowUpAt) }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ fmtTime(detail.createdAt) }}</el-descriptions-item>
        </el-descriptions>

        <div class="section-title">跟进记录</div>
        <el-empty v-if="!detail.followUps?.length" description="暂无跟进记录" :image-size="60" />
        <el-timeline v-else>
          <el-timeline-item
            v-for="f in detail.followUps"
            :key="f.id"
            :timestamp="fmtTime(f.createdAt)"
            placement="top"
          >
            <div class="follow-content">{{ f.content }}</div>
            <div v-if="f.nextFollowUpAt" class="follow-next">下次跟进：{{ fmtTime(f.nextFollowUpAt) }}</div>
            <div class="follow-operator">{{ f.operator?.name || '系统' }}</div>
          </el-timeline-item>
        </el-timeline>

        <el-button type="primary" style="width:100%;margin-top:12px" @click="openFollowUp(detail)">添加跟进记录</el-button>
      </template>
    </el-drawer>

    <el-dialog v-model="followUpVisible" :title="`添加跟进 - ${followUpForm.phone}`" width="440px">
      <el-form label-position="top">
        <el-form-item label="跟进内容" required>
          <el-input v-model="followUpForm.content" type="textarea" :rows="4" maxlength="500" show-word-limit placeholder="电话/微信沟通情况、报价、约定事项…" />
        </el-form-item>
        <el-form-item label="下次跟进时间">
          <el-date-picker
            v-model="followUpForm.nextFollowUpAt"
            type="datetime"
            placeholder="选择时间（可选）"
            value-format="YYYY-MM-DDTHH:mm:ss"
            style="width:100%"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="followUpVisible = false">取消</el-button>
        <el-button type="primary" :loading="followUpSaving" @click="submitFollowUp">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }
.search-bar { display: flex; align-items: center; margin-bottom: 20px; }
.click-table :deep(tbody tr) { cursor: pointer; }
.pager { display: flex; justify-content: flex-end; margin-top: 16px; }
.inline-loading { padding: 40px; text-align: center; color: var(--brand-muted); }
.detail-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
.detail-phone { font-size: 18px; font-weight: 750; color: var(--brand-text); }
.detail-desc { margin-bottom: 20px; }
.section-title { margin: 4px 0 12px; font-weight: 700; color: var(--brand-text); }
.follow-content { font-size: 13px; color: var(--brand-text); }
.follow-next { margin-top: 4px; font-size: 12px; color: var(--brand-text-soft); }
.follow-operator { margin-top: 4px; font-size: 12px; color: var(--brand-muted); }
</style>
