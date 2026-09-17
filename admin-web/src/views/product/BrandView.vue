<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageTable from '../../components/PageTable.vue'
import {
  createBrand,
  deleteBrand,
  getManagedBrands,
  restoreBrand,
  suggestBrandCode,
  updateBrand
} from '../../api/product'

const loading = ref(false)
const error = ref('')
const rows = ref<any[]>([])
const status = ref('')
const visible = ref(false)
const saving = ref(false)
const suggesting = ref(false)
const codeManuallyEdited = ref(false)
const form = reactive<any>({
  id: null,
  name: '',
  code: '',
  sortOrder: 0,
  logoUrl: '',
  description: ''
})

const dataOf = (response: any) => response?.data ?? response ?? {}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const response: any = await getManagedBrands(status.value ? { status: status.value } : {})
    rows.value = dataOf(response).items || dataOf(response) || []
  } catch (loadError: any) {
    error.value = loadError.message || '品牌加载失败'
  } finally {
    loading.value = false
  }
}

function openEditor(row?: any) {
  Object.assign(form, row
    ? {
        id: row.id,
        name: row.name,
        code: row.code,
        sortOrder: row.sortOrder ?? 0,
        logoUrl: row.logoUrl || '',
        description: row.description || ''
      }
    : { id: null, name: '', code: '', sortOrder: 0, logoUrl: '', description: '' }
  )
  codeManuallyEdited.value = Boolean(row)
  visible.value = true
}

function normalizeCode() {
  form.code = String(form.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  codeManuallyEdited.value = true
}

async function generateCode(force = false) {
  const name = String(form.name || '').trim()
  if (!name || (!force && codeManuallyEdited.value)) return
  suggesting.value = true
  try {
    const response: any = await suggestBrandCode(name)
    form.code = dataOf(response).code || ''
    codeManuallyEdited.value = force
  } finally {
    suggesting.value = false
  }
}

async function save() {
  const name = String(form.name || '').trim()
  const code = String(form.code || '').trim()
  if (!name) {
    ElMessage.warning('请输入品牌名称')
    return
  }
  if (!code) {
    await generateCode(true)
  }
  if (!/^[A-Z0-9]+$/.test(String(form.code || ''))) {
    ElMessage.warning('品牌编码前缀只能包含大写字母和数字')
    return
  }

  saving.value = true
  try {
    const body = {
      name,
      code: form.code,
      sortOrder: Number(form.sortOrder) || 0,
      logoUrl: String(form.logoUrl || '').trim() || undefined,
      description: String(form.description || '').trim() || undefined
    }
    if (form.id) await updateBrand(form.id, body)
    else await createBrand(body)
    ElMessage.success(form.id ? '品牌保存成功' : '品牌创建成功')
    visible.value = false
    await load()
  } catch (saveError: any) {
    ElMessage.warning(saveError.message || '品牌保存失败')
  } finally {
    saving.value = false
  }
}

async function remove(row: any) {
  const linkedProductCount = Number(row?.historicalProductCount ?? row?._count?.products ?? 0)
  try {
    await ElMessageBox.confirm(
      linkedProductCount > 0
        ? `品牌「${row.name}」关联 ${linkedProductCount} 件历史商品，删除后将安全停用且可恢复。是否继续？`
        : `品牌「${row.name}」没有关联商品，将被永久删除。是否继续？`,
      '删除品牌',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
    const response: any = await deleteBrand(row.id)
    const result = dataOf(response)
    ElMessage.success(result.deletionMode === 'physical'
      ? '品牌已永久删除'
      : '品牌已有历史商品，已安全停用')
    await load()
  } catch (removeError: any) {
    if (removeError === 'cancel' || removeError === 'close') return
    ElMessage.warning(removeError.message || '品牌删除失败')
  }
}

async function restore(row: any) {
  try {
    await restoreBrand(row.id)
    ElMessage.success('品牌已恢复')
    await load()
  } catch (restoreError: any) {
    ElMessage.warning(restoreError.message || '品牌恢复失败')
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <h1>品牌管理</h1>
        <p>维护商品品牌、编码前缀及品牌生命周期</p>
      </div>
      <el-button type="primary" @click="openEditor()">新建品牌</el-button>
    </div>

    <el-card shadow="never">
      <div class="toolbar">
        <el-radio-group v-model="status" @change="load">
          <el-radio-button value="">全部</el-radio-button>
          <el-radio-button value="active">启用中</el-radio-button>
          <el-radio-button value="disabled">已停用</el-radio-button>
        </el-radio-group>
      </div>

      <PageTable :loading="loading" :error="error" :empty="!rows.length" @retry="load">
        <el-table :data="rows" row-key="id">
          <el-table-column prop="name" label="品牌名称" min-width="160" />
          <el-table-column prop="code" label="品牌编码前缀" min-width="170" />
          <el-table-column label="当前商品数" width="120">
            <template #default="{ row }">{{ row.currentProductCount || 0 }}</template>
          </el-table-column>
          <el-table-column label="已归档" width="100">
            <template #default="{ row }">{{ row.archivedProductCount || 0 }}</template>
          </el-table-column>
          <el-table-column prop="sortOrder" label="排序" width="90" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'info'">
                {{ row.status === 'active' ? '启用中' : '已停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="openEditor(row)">编辑</el-button>
              <el-button v-if="row.status === 'disabled'" link type="success" @click="restore(row)">恢复</el-button>
              <el-button v-else link type="danger" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </PageTable>
    </el-card>

    <el-dialog v-model="visible" :title="form.id ? '编辑品牌' : '新建品牌'" width="520">
      <el-form label-width="110px">
        <el-form-item label="品牌名称" required>
          <el-input v-model="form.name" maxlength="100" placeholder="例如：德品" @blur="generateCode()" />
        </el-form-item>
        <el-form-item label="品牌编码前缀" required>
          <div class="code-row">
            <el-input v-model="form.code" maxlength="32" placeholder="例如：DEPIN" @input="normalizeCode" />
            <el-button :loading="suggesting" @click="generateCode(true)">重新生成</el-button>
          </div>
          <div class="field-hint">仅允许大写字母和数字；已生成的历史商品编码不会随品牌修改。</div>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item label="品牌图片">
          <el-input v-model="form.logoUrl" placeholder="可选，填写图片 URL" />
        </el-form-item>
        <el-form-item label="品牌说明">
          <el-input v-model="form.description" type="textarea" :rows="3" maxlength="500" show-word-limit />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" :disabled="!form.name" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page-heading { margin-bottom: 20px; }
.toolbar { display: flex; justify-content: flex-end; margin-bottom: 16px; }
.code-row { display: flex; gap: 10px; width: 100%; }
.field-hint { width: 100%; margin-top: 6px; color: var(--brand-text-soft); font-size: 12px; line-height: 1.5; }
</style>
