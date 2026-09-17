<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageTable from '../../components/PageTable.vue'
import { createCategory, deleteCategory, getManagedCategories, restoreCategory, updateCategory } from '../../api/product'

const loading = ref(false)
const error = ref('')
const rows = ref<any[]>([])
const visible = ref(false)
const saving = ref(false)
const form = reactive<any>({ id: null, name: '', parentId: null, sortOrder: 0 })

const dataOf = (r: any) => r?.data ?? r ?? {}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const c: any = await getManagedCategories()
    rows.value = dataOf(c).items || dataOf(c) || []
  } catch (e: any) {
    error.value = e.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function edit(row?: any) {
  Object.assign(form, row
    ? { id: row.id, name: row.name, parentId: row.parentId, sortOrder: row.sortOrder ?? 0 }
    : { id: null, name: '', parentId: null, sortOrder: 0 }
  )
  visible.value = true
}

async function save() {
  const name = form.name.trim()
  if (!name) {
    ElMessage.warning('请输入分类名称')
    return
  }
  const duplicated = rows.value.some((row: any) => row.id !== form.id && String(row.name || '').trim() === name)
  if (duplicated) {
    ElMessage.warning('分类名称已存在')
    return
  }
  saving.value = true
  try {
    if (form.id) {
      const body: any = { name, sortOrder: form.sortOrder }
      if (form.parentId) body.parentId = form.parentId
      await updateCategory(form.id, body)
    } else {
      const body: any = { name, code: name, sortOrder: form.sortOrder }
      if (form.parentId) body.parentId = form.parentId
      await createCategory(body)
    }
    ElMessage.success(form.id ? '保存成功' : '创建成功')
    visible.value = false
    await load()
  } catch (e: any) {
    ElMessage.warning(e.message || '操作失败')
  } finally {
    saving.value = false
  }
}

async function remove(row: any) {
  const linkedProductCount = Number(row?.historicalProductCount ?? row?._count?.products ?? 0)
  try {
    await ElMessageBox.confirm(
      linkedProductCount > 0
        ? `分类「${row.name}」关联 ${linkedProductCount} 件历史商品，删除后将安全停用且可恢复。是否继续？`
        : `分类「${row.name}」没有关联商品，将被永久删除。是否继续？`,
      '删除分类',
      { type: 'warning', confirmButtonText: '确认删除', cancelButtonText: '取消' }
    )
    const response: any = await deleteCategory(row.id)
    const result = dataOf(response)
    ElMessage.success(result.deletionMode === 'physical'
      ? '分类已永久删除'
      : '分类已有历史商品，已安全停用')
    await load()
  } catch (error: any) {
    if (error === 'cancel' || error === 'close') return
    const msg = error?.response?.data?.message || error.message || '分类删除失败，请稍后重试'
    ElMessage.warning(msg)
  }
}

async function restore(row: any) {
  try {
    await restoreCategory(row.id)
    ElMessage.success('分类已恢复')
    await load()
  } catch (error: any) {
    ElMessage.warning(error.message || '分类恢复失败')
  }
}

onMounted(load)
</script>

<template>
  <section>
    <div class="page-heading">
      <div>
        <h1>分类管理</h1>
        <p>维护商品分类、编码片段及分类生命周期</p>
      </div>
      <el-button type="primary" @click="edit()">新建分类</el-button>
    </div>
    <el-card shadow="never">
      <PageTable :loading="loading" :error="error" :empty="!rows.length" @retry="load">
        <el-table :data="rows" row-key="id" default-expand-all>
          <el-table-column prop="name" label="分类名称" min-width="220" />
          <el-table-column prop="codeSegment" label="编码片段" min-width="150" />
          <el-table-column label="当前商品数" width="120">
            <template #default="{ row }">{{ row.currentProductCount || 0 }}</template>
          </el-table-column>
          <el-table-column label="已归档" width="100">
            <template #default="{ row }">{{ row.archivedProductCount || 0 }}</template>
          </el-table-column>
          <el-table-column prop="sortOrder" label="排序" width="80" />
          <el-table-column label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === 'active' ? 'success' : 'info'">
                {{ row.status === 'active' ? '启用中' : '已停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="180">
            <template #default="{ row }">
              <el-button link type="primary" @click="edit(row)">编辑</el-button>
              <el-button v-if="row.status === 'disabled'" link type="success" @click="restore(row)">恢复</el-button>
              <el-button v-else link type="danger" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </PageTable>
    </el-card>
    <el-dialog v-model="visible" :title="form.id ? '编辑分类' : '新建分类'" width="480">
      <el-form label-width="80">
        <el-form-item label="名称">
          <el-input v-model="form.name" placeholder="请输入分类名称" />
        </el-form-item>
        <el-form-item label="父级分类">
          <el-select v-model="form.parentId" clearable placeholder="不选则为一级分类" style="width: 100%">
            <el-option v-for="x in rows.filter((r: any) => r.id !== form.id && r.status === 'active')" :key="x.id" :label="x.name" :value="x.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" />
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
.page-heading {
  justify-content: space-between;
}
</style>
