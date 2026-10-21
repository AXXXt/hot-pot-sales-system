<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AiDraft } from '../../api/ai-assistant'
import { getAiImage } from '../../api/ai-assistant'

const props = defineProps<{ draft: AiDraft; options: { brands: any[]; categories: any[]; canCreateBrand?: boolean; canCreateCategory?: boolean }; allowExecute: boolean; busy: boolean }>()
const emit = defineEmits<{ save: [draft: AiDraft, payload: any]; confirm: [draft: AiDraft] }>()
const form = ref<any>({})
const taskDate = ref('')
const photoUrls = ref<string[]>([])
const photoError = ref('')
const brandMode = ref('existing'); const categoryMode = ref('existing')
let photoEpoch = 0
function clearPhotos() { photoUrls.value.forEach(url => URL.revokeObjectURL(url)); photoUrls.value = [] }
watch(() => JSON.stringify(props.draft.payload?.attachmentIds || []), async () => {
  const epoch = ++photoEpoch; clearPhotos(); photoError.value = ''
  try {
    const blobs = await Promise.all((props.draft.payload?.attachmentIds || []).map((id: string) => getAiImage(id)))
    if (epoch === photoEpoch) photoUrls.value = blobs.map((blob: Blob) => URL.createObjectURL(blob))
  } catch { if (epoch === photoEpoch) photoError.value = '照片已过期或当前不可访问，请重新上传核对。' }
}, { immediate: true })
onBeforeUnmount(() => { photoEpoch++; clearPhotos() })
watch(() => props.draft, value => {
  form.value = JSON.parse(JSON.stringify(value.payload))
  brandMode.value = !value.payload.brandId && (value.payload.brandName || (!props.options.brands.length && props.options.canCreateBrand)) ? 'new' : 'existing'
  categoryMode.value = !value.payload.categoryId && (value.payload.categoryName || (!props.options.categories.length && props.options.canCreateCategory)) ? 'new' : 'existing'
  taskDate.value = value.action === 'task.create' ? new Date(new Date(value.payload.dueAt).getTime() + 8 * 3600000).toISOString().slice(0, 16) : ''
}, { immediate: true, deep: true })
const completed = computed(() => props.draft.status === 'succeeded')
const changed = computed(() => JSON.stringify(payload()) !== JSON.stringify(props.draft.payload))
function payload() {
  return props.draft.action === 'task.create' ? { title: form.value.title, dueAt: taskDate.value ? new Date(`${taskDate.value}+08:00`).toISOString() : '' } : form.value
}
function switchCatalog(kind: 'brand' | 'category') {
  const mode = kind === 'brand' ? brandMode : categoryMode
  mode.value = mode.value === 'new' ? 'existing' : 'new'
  form.value[`${kind}Id`] = null
  form.value[`${kind}Name`] = ''
}
</script>

<template>
  <section class="ai-draft" aria-label="业务草稿">
    <div class="draft-heading"><strong>{{ draft.action === 'product.create' ? '商品草稿' : '个人提醒草稿' }}</strong><span>{{ completed ? '已执行' : '尚未执行' }}</span></div>
    <div v-if="photoUrls.length" class="draft-photos"><el-image v-for="(url, index) in photoUrls" :key="url" :src="url" :alt="`包装照片${index + 1}`" :preview-src-list="photoUrls" :initial-index="index" preview-teleported fit="cover" /><span>点击照片放大核对字段</span></div>
    <p v-if="photoError" class="draft-warning">{{ photoError }}</p>
    <el-form v-if="draft.action === 'product.create'" label-position="top" :disabled="completed || busy" size="small">
      <div class="field-pair">
        <el-form-item>
          <template #label><span class="catalog-label">品牌<el-button v-if="!completed && (options.canCreateBrand || brandMode === 'new')" text size="small" @click="switchCatalog('brand')">{{ brandMode === 'new' ? '选择已有品牌' : '新建品牌' }}</el-button></span></template>
          <template v-if="brandMode === 'new'"><el-input v-model="form.brandName" aria-label="新品牌名称" maxlength="100" placeholder="输入或核对包装上的品牌名称" /><small class="catalog-hint">{{ options.canCreateBrand ? '确认时新建，同名可用品牌会优先复用。' : '需品牌管理权限；可改选已授权品牌。' }}</small></template>
          <el-select v-else v-model="form.brandId" filterable clearable placeholder="选择品牌"><el-option v-for="item in options.brands" :key="item.id" :value="item.id" :label="item.name" /></el-select>
        </el-form-item>
        <el-form-item>
          <template #label><span class="catalog-label">分类<el-button v-if="!completed && (options.canCreateCategory || categoryMode === 'new')" text size="small" @click="switchCatalog('category')">{{ categoryMode === 'new' ? '选择已有分类' : '新建分类' }}</el-button></span></template>
          <template v-if="categoryMode === 'new'"><el-input v-model="form.categoryName" aria-label="新分类名称" maxlength="100" placeholder="例如：鸭血制品" /><small class="catalog-hint">{{ options.canCreateCategory ? '核对建议名称，确认时与商品一并创建。' : '需商品维护权限；可改选已有分类。' }}</small></template>
          <el-select v-else v-model="form.categoryId" filterable clearable placeholder="选择分类"><el-option v-for="item in options.categories" :key="item.id" :value="item.id" :label="item.name" /></el-select>
        </el-form-item>
      </div>
      <el-form-item label="商品名称" required><el-input v-model="form.subtitle" maxlength="200" placeholder="填写或核对真实商品名，例如：爆汁牛筋丸" /></el-form-item>
      <div v-for="(sku, index) in form.skus" :key="index" class="sku-fields">
        <el-form-item :label="`规格 ${Number(index) + 1}`"><el-input v-model="sku.specText" placeholder="例如：500g×20袋/箱" /></el-form-item>
        <div class="field-pair">
          <el-form-item label="销售单位"><el-input v-model="sku.saleUnit" placeholder="箱 / 袋" /></el-form-item>
          <el-form-item :label="`售价（元/${sku.saleUnit || '销售单位'}）`"><el-input v-model="sku.basePrice" inputmode="decimal" placeholder="填写销售价" /></el-form-item>
        </div>
        <el-form-item label="起订量"><el-input-number v-model="sku.minOrderQty" :min="1" :max="100000" /></el-form-item>
      </div>
      <p class="draft-note">商品名称用于客户展示，可直接修改；管理标签和编码由系统生成。创建后下架、库存为0；商品主图在编辑页上传。</p>
    </el-form>
    <el-form v-else label-position="top" :disabled="completed || busy" size="small">
      <el-form-item label="事项"><el-input v-model="form.title" maxlength="200" /></el-form-item>
      <el-form-item label="提醒时间（北京时间）"><input v-model="taskDate" type="datetime-local" class="task-date" /></el-form-item>
    </el-form>
    <p v-if="!completed && draft.missing?.length" class="draft-warning">待补充：{{ draft.missing.join('、') }}</p>
    <div v-if="!completed" class="draft-actions">
      <el-button size="small" :disabled="!changed || busy" @click="emit('save', draft, payload())">保存修改</el-button>
      <el-button type="primary" size="small" :loading="busy" :disabled="changed || !allowExecute || !!draft.missing?.length" @click="emit('confirm', draft)">{{ draft.action === 'product.create' ? '检查并创建' : '确认添加提醒' }}</el-button>
    </div>
    <p v-if="!allowExecute && !completed" class="draft-note">需要开启业务写入，并拥有AI执行及对应业务权限。</p>
  </section>
</template>

<style scoped>
.ai-draft { border: 1px solid var(--brand-border); border-radius: 6px; padding: 16px; background: white; margin-top: 12px; }
.draft-heading { display: flex; gap: 12px; justify-content: space-between; margin-bottom: 14px; }
.draft-heading span, .draft-note { font-size: 12px; color: var(--brand-text-soft); line-height: 1.7; }
.draft-photos { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.draft-photos .el-image { width: 64px; height: 64px; border-radius: 4px; }
.draft-photos span { font-size: 12px; color: var(--brand-text-soft); }
.field-pair { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 12px; }
.catalog-label { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.catalog-label .el-button { padding: 0 4px; min-height: 24px; }
.catalog-hint { display: block; margin-top: 6px; line-height: 1.6; color: var(--brand-text-soft); font-size: 12px; }
.sku-fields { border-top: 1px solid var(--brand-border); padding-top: 12px; }
.draft-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.draft-actions .el-button { margin: 0; }
.draft-warning { color: #9b5e10; line-height: 1.7; font-size: 12px; }
.task-date { width: 100%; padding: 8px; border: 1px solid var(--brand-border); border-radius: 4px; background: white; color: var(--brand-text); font-size: 16px; }
@media(max-width:420px) { .field-pair { grid-template-columns: minmax(0,1fr); gap: 0; } }
</style>
