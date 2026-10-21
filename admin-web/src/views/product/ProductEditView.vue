<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createProduct, createSku, getBrands, getCategories, getProductDetail, updateProduct, updateProductStatus, updateSku, updateSkuStatus, uploadProductImage } from '../../api/product'
import { validateProductImageFile } from '../../utils/product-image'

const route = useRoute()
const router = useRouter()
const id = computed(() => Number(route.params.id))
const isNew = computed(() => !id.value)
const loading = ref(!isNew.value)
const saving = ref(false)
const skuSaving = ref(false)
const statusSaving = ref(false)
const productStatus = ref('')
const uploadingImage = ref(false)
const imageInput = ref<HTMLInputElement>()
const uploadProgress = ref('')
const brands = ref<any[]>([])
const categories = ref<any[]>([])
const skus = ref<any[]>([])
const skuVisible = ref(false)
const originalBrandId = ref<number | null>(null)
const originalCategoryId = ref<number | null>(null)
const nameError = ref('')

const form = reactive<any>({ name: '', subtitle: '', productCode: '', brandId: null, categoryId: null, description: '', specification: '', images: [] as string[], isFactoryProduct: false, supportSample: false, isRecommended: false, isNew: false, isHot: false })
const sku = reactive<any>({ id: null, skuCode: '', specName: '', saleUnit: '件', salePrice: 0, minOrderQty: 1, stockNum: 0, status: 'active', imageUrl: '', packagingUnits: [], lowStockThreshold: 10, leadTimeDays: 3, safetyStock: 0, batchTracking: false })

const dataOf = (r: any) => r?.data ?? r ?? {}
const selectedBrand = computed(() => brands.value.find((item) => item.id === form.brandId))
const selectedCategory = computed(() => categories.value.find((item) => item.id === form.categoryId))
const generatedName = computed(() => selectedBrand.value && selectedCategory.value
  ? `${selectedBrand.value.name}${selectedCategory.value.name}`
  : '')
const generatedCodePreview = computed(() => selectedBrand.value && selectedCategory.value
  ? `${selectedBrand.value.code}-${selectedCategory.value.codeSegment}-***`
  : '')
const identityChanged = computed(() => !isNew.value && (
  form.brandId !== originalBrandId.value || form.categoryId !== originalCategoryId.value
))
const displayedName = computed(() => isNew.value || identityChanged.value ? generatedName.value : form.name || generatedName.value)
const displayedCode = computed(() => isNew.value || identityChanged.value ? generatedCodePreview.value : form.productCode || generatedCodePreview.value)
const nextSkuCode = computed(() => {
  const sequence = skus.value.reduce((max, item) => {
    const value = Number(item.skuCode?.match(/-(\d+)$/)?.[1] || 0)
    return Number.isSafeInteger(value) ? Math.max(max, value) : max
  }, 0) + 1
  return `${form.productCode}-${String(sequence).padStart(2, '0')}`
})

async function init() {
  loading.value = true
  try {
    const [brandResponse, categoryResponse]: any[] = await Promise.all([getBrands(), getCategories()])
    brands.value = dataOf(brandResponse).items || dataOf(brandResponse) || []
    categories.value = dataOf(categoryResponse).items || dataOf(categoryResponse) || []
    if (id.value) {
      const r: any = await getProductDetail(id.value)
      const x = dataOf(r)
      productStatus.value = x.status
      form.name = x.managementLabel || x.name || ''
      form.subtitle = x.subtitle || ''
      form.productCode = x.code || ''
      form.brandId = x.brandId || x.brand?.id
      form.categoryId = x.categoryId || x.category?.id
      form.description = x.description || ''
      form.specification = x.baseSpec || ''
      form.images = Array.isArray(x.images) && x.images.length ? [...x.images] : x.mainImageUrl ? [x.mainImageUrl] : []
      form.isFactoryProduct = x.isFactoryProduct ?? false
      form.supportSample = x.supportSample ?? false
      form.isRecommended = x.isRecommended ?? false
      form.isNew = x.isNew ?? false
      form.isHot = x.isHot ?? false
      skus.value = x.skus || []
      originalBrandId.value = form.brandId
      originalCategoryId.value = form.categoryId
    }
  } finally { loading.value = false }
}

async function saveProduct() {
  if (saving.value) return
  if (uploadingImage.value) {
    ElMessage.warning('商品图片正在上传，请稍候')
    return
  }
  if (!form.brandId || !form.categoryId) {
    ElMessage.warning('请选择品牌和分类')
    return
  }
  const productName = form.subtitle.trim()
  nameError.value = !productName ? '请填写真实商品名称' : Array.from(productName).length > 255 ? '商品名称不能超过255个字' : ''
  if (nameError.value) return

  if (identityChanged.value) {
    try {
      await ElMessageBox.confirm(
        '更换品牌或分类将生成新商品编码，旧编码不会再次使用。是否继续？',
        '重新生成商品编码',
        { type: 'warning', confirmButtonText: '继续保存', cancelButtonText: '取消' }
      )
    } catch {
      return
    }
  }

  saving.value = true
  try {
    const body: any = {
      brandId: form.brandId, categoryId: form.categoryId,
      subtitle: productName,
      baseSpec: form.specification, mainImageUrl: form.images[0] || '', images: [...form.images],
      description: form.description,
      isFactoryProduct: form.isFactoryProduct,
      supportSample: form.supportSample,
      isRecommended: form.isRecommended,
      isNew: form.isNew,
      isHot: form.isHot
    }
    let response: any
    if (isNew.value) {
      response = await createProduct(body)
    } else {
      response = await updateProduct(id.value, body)
    }
    const product = dataOf(response)
    form.name = product.managementLabel || form.name || generatedName.value
    form.subtitle = product.subtitle || productName
    form.productCode = product.code || form.productCode
    form.brandId = product.brandId || product.brand?.id || form.brandId
    form.categoryId = product.categoryId || product.category?.id || form.categoryId
    originalBrandId.value = form.brandId
    originalCategoryId.value = form.categoryId
    ElMessage.success(`商品保存成功，正式编码：${form.productCode}`)
    if (isNew.value) await router.push(`/products/${product.id}/edit`)
  } catch (e: any) { ElMessage.warning(e.message || '保存失败') }
  finally { saving.value = false }
}

async function handleImageSelection(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = ''
  if (!files.length || uploadingImage.value) return
  if (form.images.length + files.length > 9) {
    ElMessage.warning(`每个商品最多9张图片，还可添加${9 - form.images.length}张`)
    return
  }
  const invalid = files.map(file => ({ file, message: validateProductImageFile(file) })).find(item => item.message)
  if (invalid) { ElMessage.warning(`${invalid.file.name}：${invalid.message}`); return }
  uploadingImage.value = true
  let succeeded = 0
  try {
    // 按选择顺序上传，单张失败不覆盖其他成功图片。
    for (const [index, file] of files.entries()) {
      uploadProgress.value = `正在上传 ${index + 1} / ${files.length}`
      try {
        const data = dataOf(await uploadProductImage(file))
        if (typeof data.url !== 'string' || !data.url) throw new Error('上传响应缺少图片地址')
        if (!form.images.includes(data.url)) form.images.push(data.url)
        succeeded++
      } catch (error: any) { ElMessage.warning(`${file.name}：${error.message || '上传失败，请重新添加'}`) }
    }
    if (succeeded) ElMessage.success(`已上传${succeeded}张图片，保存商品后生效`)
  } finally { uploadingImage.value = false; uploadProgress.value = '' }
}

function moveImage(index: number, target: number) {
  if (uploadingImage.value || target < 0 || target >= form.images.length) return
  const [image] = form.images.splice(index, 1)
  form.images.splice(target, 0, image)
}

function removeImage(index: number) {
  if (!uploadingImage.value) form.images.splice(index, 1)
}

function editSku(x?: any) {
  Object.assign(sku, { imageUrl: '', packagingUnits: [], lowStockThreshold: 10, leadTimeDays: 3, safetyStock: 0, batchTracking: false }, x ? { ...JSON.parse(JSON.stringify(x)), packagingUnits: Array.isArray(x.packagingUnits) ? JSON.parse(JSON.stringify(x.packagingUnits)) : [], specName: x.specText || '', saleUnit: x.saleUnit || '件', salePrice: Number(x.basePrice ?? 0) } : { id: null, skuCode: '', specName: '', saleUnit: '件', salePrice: 0, minOrderQty: 1, stockNum: 0, status: 'active' })
  skuVisible.value = true
}

async function saveSku() {
  if (skuSaving.value) return
  if (!sku.specName.trim() || !sku.saleUnit.trim()) {
    ElMessage.warning('请填写规格名和销售单位')
    return
  }
  skuSaving.value = true
  try {
    const body: any = { specText: sku.specName.trim(), saleUnit: sku.saleUnit.trim(), basePrice: String(sku.salePrice), minOrderQty: sku.minOrderQty, imageUrl: sku.imageUrl || '', packagingUnits: sku.packagingUnits || [], lowStockThreshold: sku.lowStockThreshold, leadTimeDays: sku.leadTimeDays, safetyStock: sku.safetyStock, batchTracking: sku.batchTracking }
    if (sku.id) { await updateSku(sku.id, body) }
    else { body.name = sku.specName.trim(); await createSku(id.value, body) }
    ElMessage.success('商品规格已保存')
    skuVisible.value = false
    await init()
  } catch (e: any) { ElMessage.warning(e.message || '商品规格保存失败') }
  finally { skuSaving.value = false }
}

async function toggleProductStatus() {
  if (statusSaving.value) return
  const status = productStatus.value === 'active' ? 'disabled' : 'active'
  try {
    await ElMessageBox.confirm(status === 'active'
      ? '上架后将按客户可见范围展示；零库存规格仍不可下单。确认上架？'
      : '下架后客户将无法查看和购买该商品。确认下架？', '商品上下架', {
        type: 'warning', confirmButtonText: status === 'active' ? '确认上架' : '确认下架',
        cancelButtonText: '取消'
      })
    statusSaving.value = true
    await updateProductStatus(id.value, status)
    productStatus.value = status
    ElMessage.success(status === 'active' ? '商品已上架' : '商品已下架')
  } catch (e: any) {
    if (e !== 'cancel' && e !== 'close') ElMessage.warning(e.message || '商品状态更新失败')
  } finally { statusSaving.value = false }
}

async function toggleSku(x: any) {
  try {
    await ElMessageBox.confirm('确认修改商品规格状态？', '操作确认')
    await updateSkuStatus(x.id, x.status === 'active' ? 'disabled' : 'active')
    await init()
  } catch { /* cancelled */ }
}

onMounted(init)
watch(() => route.params.id, init)
</script>

<template>
  <section v-loading="loading">
    <div class="page-heading">
      <div><h1>{{ isNew ? '新建商品' : '编辑商品' }}</h1><p>维护基础资料及销售规格</p></div>
      <div><el-button @click="router.back()">返回</el-button><el-button type="primary" :loading="saving" :disabled="uploadingImage" @click="saveProduct">保存商品</el-button></div>
    </div>

    <el-alert v-if="!isNew && productStatus === 'disabled'" title="该商品当前已下架，小程序和采购网站不可见。请核对资料与规格后上架。" type="warning" :closable="false" show-icon class="publication-alert">
      <el-button type="primary" :loading="statusSaving" @click="toggleProductStatus">上架商品</el-button>
    </el-alert>
    <el-alert v-if="!isNew && productStatus === 'active' && !skus.some(item => item.status === 'active' && item.stockNum > 0)" title="商品已上架，但暂无有货规格。请在库存管理中按实际数量入库，客户才能下单。" type="info" :closable="false" class="publication-alert" />
    <el-alert v-if="!loading && !isNew && !form.subtitle.trim()" title="尚未填写真实商品名称，客户暂时看到管理标签，请补齐下方商品名称。" type="warning" :closable="false" class="publication-alert" />

    <el-card shadow="never">
      <el-form :model="form" label-width="100">
        <el-row :gutter="20">
          <el-col :span="24"><el-form-item label="商品名称" for="product-title" required :error="nameError"><el-input id="product-title" v-model="form.subtitle" maxlength="255" placeholder="请输入真实商品名称，例如：爆汁牛筋丸" @input="nameError = ''" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="品牌" required><el-select v-model="form.brandId" filterable placeholder="请选择品牌" style="width:100%"><el-option v-for="x in brands" :key="x.id" :label="x.name" :value="x.id" /></el-select></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="分类" required><el-select v-model="form.categoryId" filterable placeholder="请选择分类" style="width:100%"><el-option v-for="x in categories" :key="x.id" :label="x.name" :value="x.id" /></el-select></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="管理标签" for="product-label"><el-input id="product-label" :model-value="displayedName" readonly placeholder="选择品牌和分类后自动生成" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="商品编码"><el-input :model-value="displayedCode" readonly placeholder="选择品牌和分类后预览" /></el-form-item></el-col>
          <el-col :span="24"><p class="identity-tip">管理标签由“品牌 + 分类”生成，商品编码由系统分配。商品名称可按实际商品修改，不影响标签、编码、规格或库存。更换品牌或分类将生成新商品编码。</p></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="规格"><el-input v-model="form.specification" /></el-form-item></el-col>
          <el-col :span="24">
            <div class="product-flag-grid">
              <div class="product-flag-item"><span>工厂自产</span><el-switch v-model="form.isFactoryProduct" /></div>
              <div class="product-flag-item"><span>支持样品</span><el-switch v-model="form.supportSample" /></div>
              <div class="product-flag-item"><span>推荐商品</span><el-switch v-model="form.isRecommended" /></div>
              <div class="product-flag-item"><span>新品</span><el-switch v-model="form.isNew" /></div>
              <div class="product-flag-item"><span>热销</span><el-switch v-model="form.isHot" /></div>
            </div>
          </el-col>
          <el-col :span="24">
            <el-form-item label="商品图片">
              <div class="product-image-field">
                <div v-if="form.images.length" class="product-image-grid">
                  <div v-for="(url, index) in form.images" :key="url" class="product-image-card">
                    <div class="product-image-preview">
                      <el-image :src="url" :preview-src-list="form.images" :initial-index="index" fit="contain" preview-teleported />
                      <span class="product-image-number">{{ index === 0 ? '主图' : `第${index + 1}张` }}</span>
                    </div>
                    <div class="product-image-controls">
                      <el-button size="small" :disabled="uploadingImage || index === 0" :aria-label="`将第${index + 1}张设为主图`" @click="moveImage(index, 0)">设为主图</el-button>
                      <el-button size="small" :disabled="uploadingImage || index === 0" :aria-label="`前移第${index + 1}张图片`" @click="moveImage(index, index - 1)">前移</el-button>
                      <el-button size="small" :disabled="uploadingImage || index === form.images.length - 1" :aria-label="`后移第${index + 1}张图片`" @click="moveImage(index, index + 1)">后移</el-button>
                      <el-button size="small" type="danger" :disabled="uploadingImage" :aria-label="`删除第${index + 1}张图片`" @click="removeImage(index)">删除</el-button>
                    </div>
                  </div>
                </div>
                <div v-else class="product-image-empty">暂无商品图片</div>
                <input ref="imageInput" class="product-image-input" type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="选择商品图片" :disabled="uploadingImage || saving" @change="handleImageSelection" />
                <div class="product-image-actions">
                  <el-button type="primary" plain :loading="uploadingImage" :disabled="form.images.length >= 9 || saving" @click="imageInput?.click()">添加图片</el-button>
                  <span aria-live="polite">{{ uploadProgress || `${form.images.length} / 9 张` }}</span>
                </div>
                <p class="product-image-tip">最多9张，支持 JPG、PNG、WebP，单张不超过5MB。第一张为列表主图，详情页按顺序滑动查看；添加、排序或删除后请保存商品。</p>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="24"><el-form-item label="描述"><el-input v-model="form.description" type="textarea" :rows="4" /></el-form-item></el-col>
        </el-row>
      </el-form>
    </el-card>

    <el-card v-if="!isNew" shadow="never" class="sku-card">
      <template #header><div class="card-title"><b>商品规格管理</b><el-button type="primary" size="small" @click="editSku()">新建规格</el-button></div></template>
      <el-empty v-if="!skus.length" description="暂无商品规格" />
      <el-table v-else :data="skus" size="small">
        <el-table-column prop="skuCode" label="规格编码" width="130" />
        <el-table-column label="规格图片" width="90"><template #default="{ row }"><el-image v-if="row.imageUrl || form.images[0]" :src="row.imageUrl || form.images[0]" style="width:52px;height:52px" fit="contain" :alt="row.specText" /></template></el-table-column><el-table-column prop="specText" label="规格" min-width="120" />
        <el-table-column label="售价" width="100"><template #default="{ row }">¥{{ Number(row.basePrice || 0).toFixed(2) }}</template></el-table-column>
        <el-table-column prop="minOrderQty" label="起订量" width="80" />
        <el-table-column label="库存" width="110">
          <template #default="{ row }">
            <span>{{ row.stockNum }}（出入库调整）</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '启用' : '禁用' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="210">
          <template #default="{ row }">
            <el-button link type="primary" @click="editSku(row)">编辑</el-button><el-button link type="primary" @click="editSku({ ...row, id: null, skuCode: '', stockNum: 0, reservedNum: 0 })">复制规格</el-button>
            <el-button link @click="toggleSku(row)">{{ row.status === 'active' ? '禁用' : '启用' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="skuVisible" class="sku-editor-dialog" top="5vh" :title="sku.id ? '编辑商品规格' : '新建商品规格'" width="min(620px, 94vw)">
      <el-form label-width="90">
        <el-form-item label="编码"><el-input :model-value="sku.id ? sku.skuCode : nextSkuCode" readonly aria-label="规格编码" /><small v-if="!sku.id">按已有规格继续编号，正式编码在保存时分配。</small></el-form-item>
        <el-form-item label="规格名"><el-input v-model="sku.specName" /></el-form-item>
        <el-form-item label="销售单位"><el-input v-model="sku.saleUnit" maxlength="50" placeholder="例如：袋、箱" /></el-form-item>
        <el-form-item label="规格图片"><el-select v-model="sku.imageUrl" aria-label="规格专属图片" clearable placeholder="沿用商品主图"><el-option v-for="(url, index) in form.images" :key="url" :value="url" :label="`商品图片第${index + 1}张`"><el-image :src="url" style="width:32px;height:32px;vertical-align:middle" fit="contain" /> 图片第{{ index + 1 }}张</el-option></el-select><small>图片须先保存到商品图库，客户选规格时同步切换。</small></el-form-item>
        <el-form-item label="包装换算"><div><div v-for="(pack, index) in sku.packagingUnits" :key="index" class="packaging-row"><el-input v-model="pack.unit" :aria-label="`包装单位${Number(index) + 1}`" placeholder="箱" maxlength="20" /><span>＝</span><el-input-number v-model="pack.factor" :min="2" :max="100000" :precision="0" :aria-label="`每包装基础数量${Number(index) + 1}`" /><span>{{ sku.saleUnit }}</span><el-button @click="sku.packagingUnits.splice(index, 1)">删除</el-button></div><el-button :disabled="sku.packagingUnits.length >= 5" @click="sku.packagingUnits.push({ unit: '', factor: 2 })">添加包装单位</el-button><p class="identity-tip">箱、袋共用本规格库存，按基础销售单位核算。不同净含量请建立独立规格。</p></div></el-form-item>
        <el-form-item label="最低库存"><el-input-number v-model="sku.lowStockThreshold" aria-label="最低库存" :min="0" :max="2147483647" :precision="0" /></el-form-item>
        <el-form-item label="供货天数"><el-input-number v-model="sku.leadTimeDays" aria-label="供货天数" :min="1" :max="365" :precision="0" /></el-form-item>
        <el-form-item label="安全库存"><el-input-number v-model="sku.safetyStock" aria-label="安全库存" :min="0" :max="2147483647" :precision="0" /></el-form-item>
        <el-form-item label="批次管理"><el-switch v-model="sku.batchTracking" :disabled="skus.some(x => x.id === sku.id && x.batchTracking)" aria-label="启用批次管理" /><small>启用后保留批次追溯，不支持关闭；入库须填批次号和到期日期。历史库存显示日期未知，订单先到期先出。</small></el-form-item>
        <el-form-item label="售价"><el-input-number v-model="sku.salePrice" :min="0" :precision="2" style="width:100%" /></el-form-item>
        <el-form-item label="起订量"><el-input-number v-model="sku.minOrderQty" :min="1" /></el-form-item>
        <p style="color:var(--brand-text-soft);font-size:12px">库存通过库存管理中的出入库单调整；新规格初始库存为0。</p>
      </el-form>
      <template #footer><el-button @click="skuVisible = false">取消</el-button><el-button type="primary" :loading="skuSaving" @click="saveSku">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
:global(.sku-editor-dialog .el-dialog__body) { max-height:calc(90dvh - 150px); overflow-y:auto; }
.packaging-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-bottom:8px; }
.packaging-row .el-input { width:72px; }
small { display:block; line-height:1.6; color:var(--brand-text-soft); }
.page-heading, .card-title { display: flex; justify-content: space-between; align-items: center; }
.page-heading { margin-bottom: 20px; }
.card-title { color: var(--brand-text); font-weight: 600; }
.sku-card { margin-top: 18px; }
.publication-alert { margin-bottom: 18px; }
.product-flag-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 20px; row-gap: 8px; margin-bottom: 18px; }
.product-flag-item { display: grid; grid-template-columns: 100px auto; align-items: center; min-height: 40px; }
.product-flag-item span { padding-right: 12px; color: var(--el-text-color-regular); text-align: right; line-height: 32px; }
.product-image-grid { display: flex; flex-wrap: wrap; gap: 16px; }
.product-image-card { width: 224px; }
.product-image-preview { width: 100% !important; }
.product-image-controls { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.product-image-controls .el-button { margin-left: 0; min-height: 32px; }
.product-image-number { position: absolute; top: 6px; left: 6px; padding: 0 8px; color: white; background: #273e32; border-radius: 3px; font-size: 12px; pointer-events: none; }
.product-image-input { display: none; }
.product-image-field { width: 100%; display: flex; flex-direction: column; gap: 12px; }
.product-image-preview, .product-image-empty { position: relative; width: 168px; height: 168px; overflow: hidden; border: 1px dashed var(--brand-border); }
.product-image-preview :deep(.el-image) { width: 100%; height: 100%; display: block; }
.product-image-empty { display: flex; align-items: center; justify-content: center; color: var(--brand-text-soft); font-size: 13px; }
.product-image-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.product-image-tip { color: var(--brand-text-soft); font-size: 12px; line-height: 1.5; }
.identity-tip { margin: -4px 0 18px 100px; color: var(--brand-text-soft); font-size: 12px; line-height: 1.6; }
@media (max-width: 768px) {
  .product-flag-grid { grid-template-columns: 1fr; }
  .identity-tip { margin-left: 0; }
}
@media (max-width: 640px) {
  .page-heading { align-items: flex-start; flex-direction: column; gap: 12px; }
  .page-heading > div:last-child { display: flex; justify-content: flex-end; width: 100%; }
  .product-image-preview, .product-image-empty { position: relative; width: 140px; height: 140px; }
}
</style>
