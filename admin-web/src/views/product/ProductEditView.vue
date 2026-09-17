<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { UploadRawFile, UploadRequestOptions } from 'element-plus'
import { createProduct, createSku, getBrands, getCategories, getProductDetail, updateProduct, updateSku, updateSkuStatus, uploadProductImage } from '../../api/product'
import { validateProductImageFile } from '../../utils/product-image'

const route = useRoute()
const router = useRouter()
const id = Number(route.params.id)
const isNew = !id
const loading = ref(!isNew)
const saving = ref(false)
const uploadingImage = ref(false)
const brands = ref<any[]>([])
const categories = ref<any[]>([])
const skus = ref<any[]>([])
const skuVisible = ref(false)
const originalBrandId = ref<number | null>(null)
const originalCategoryId = ref<number | null>(null)

const form = reactive<any>({ name: '', subtitle: '', productCode: '', brandId: null, categoryId: null, description: '', specification: '', imageUrl: '', isFactoryProduct: false, supportSample: false, isRecommended: false, isNew: false, isHot: false })
const sku = reactive<any>({ id: null, skuCode: '', specName: '', salePrice: 0, minOrderQty: 1, stockNum: 0, status: 'active' })

const dataOf = (r: any) => r?.data ?? r ?? {}
const selectedBrand = computed(() => brands.value.find((item) => item.id === form.brandId))
const selectedCategory = computed(() => categories.value.find((item) => item.id === form.categoryId))
const generatedName = computed(() => selectedBrand.value && selectedCategory.value
  ? `${selectedBrand.value.name}${selectedCategory.value.name}`
  : '')
const generatedCodePreview = computed(() => selectedBrand.value && selectedCategory.value
  ? `${selectedBrand.value.code}-${selectedCategory.value.codeSegment}-***`
  : '')
const identityChanged = computed(() => !isNew && (
  form.brandId !== originalBrandId.value || form.categoryId !== originalCategoryId.value
))
const displayedName = computed(() => isNew || identityChanged.value ? generatedName.value : form.name || generatedName.value)
const displayedCode = computed(() => isNew || identityChanged.value ? generatedCodePreview.value : form.productCode || generatedCodePreview.value)

async function init() {
  try {
    const [brandResponse, categoryResponse]: any[] = await Promise.all([getBrands(), getCategories()])
    brands.value = dataOf(brandResponse).items || dataOf(brandResponse) || []
    categories.value = dataOf(categoryResponse).items || dataOf(categoryResponse) || []
    if (id) {
      const r: any = await getProductDetail(id)
      const x = dataOf(r)
      form.name = x.name || ''
      form.subtitle = x.subtitle || ''
      form.productCode = x.code || ''
      form.brandId = x.brandId || x.brand?.id
      form.categoryId = x.categoryId || x.category?.id
      form.description = x.description || ''
      form.specification = x.baseSpec || ''
      form.imageUrl = x.mainImageUrl || ''
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
  if (uploadingImage.value) {
    ElMessage.warning('商品图片正在上传，请稍候')
    return
  }
  if (!form.brandId || !form.categoryId) {
    ElMessage.warning('请选择品牌和分类')
    return
  }

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
      subtitle: form.subtitle,
      baseSpec: form.specification, mainImageUrl: form.imageUrl,
      description: form.description,
      isFactoryProduct: form.isFactoryProduct,
      supportSample: form.supportSample,
      isRecommended: form.isRecommended,
      isNew: form.isNew,
      isHot: form.isHot
    }
    let response: any
    if (isNew) {
      response = await createProduct(body)
    } else {
      response = await updateProduct(id, body)
    }
    const product = dataOf(response)
    form.name = product.name || generatedName.value
    form.productCode = product.code || form.productCode
    form.brandId = product.brandId || product.brand?.id || form.brandId
    form.categoryId = product.categoryId || product.category?.id || form.categoryId
    originalBrandId.value = form.brandId
    originalCategoryId.value = form.categoryId
    ElMessage.success(`商品保存成功，正式编码：${form.productCode}`)
    if (isNew) await router.push('/products')
  } catch (e: any) { ElMessage.warning(e.message || '保存失败') }
  finally { saving.value = false }
}

function beforeImageUpload(file: UploadRawFile) {
  const message = validateProductImageFile(file)
  if (message) {
    ElMessage.warning(message)
    return false
  }
  return true
}

async function handleImageUpload(options: UploadRequestOptions) {
  const previousUrl = form.imageUrl
  uploadingImage.value = true
  try {
    const response: any = await uploadProductImage(options.file)
    const data = dataOf(response)
    if (typeof data.url !== 'string' || !data.url) {
      throw new Error('上传响应缺少图片地址')
    }
    form.imageUrl = data.url
    ElMessage.success('商品图片上传成功')
    return data
  } catch (error: any) {
    form.imageUrl = previousUrl
    ElMessage.warning(error.message || '商品图片上传失败')
    throw error
  } finally {
    uploadingImage.value = false
  }
}

function removeImage() {
  form.imageUrl = ''
}

function editSku(x?: any) {
  Object.assign(sku, x ? { ...x, salePrice: Number(x.basePrice || x.salePrice || 0) } : { id: null, skuCode: '', specName: '', salePrice: 0, minOrderQty: 1, stockNum: 0, status: 'active' })
  skuVisible.value = true
}

async function saveSku() {
  try {
    const body: any = { specText: sku.specName, saleUnit: '件', basePrice: String(sku.salePrice), minOrderQty: sku.minOrderQty, stockNum: sku.stockNum }
    if (sku.id) { await updateSku(sku.id, body) }
    else { body.skuCode = sku.skuCode; body.name = sku.specName; await createSku(id, body) }
    ElMessage.success('商品规格已保存')
    skuVisible.value = false
    await init()
  } catch (e: any) { ElMessage.warning(e.message || '商品规格保存失败') }
}

async function toggleSku(x: any) {
  try {
    await ElMessageBox.confirm('确认修改商品规格状态？', '操作确认')
    await updateSkuStatus(x.id, x.status === 'active' ? 'disabled' : 'active')
    await init()
  } catch { /* cancelled */ }
}

onMounted(init)
</script>

<template>
  <section v-loading="loading">
    <div class="page-heading">
      <div><h1>{{ isNew ? '新建商品' : '编辑商品' }}</h1><p>维护基础资料及销售规格</p></div>
      <div><el-button @click="router.back()">返回</el-button><el-button type="primary" :loading="saving" :disabled="uploadingImage" @click="saveProduct">保存商品</el-button></div>
    </div>

    <el-card shadow="never">
      <el-form :model="form" label-width="100">
        <el-row :gutter="20">
          <el-col :span="12" :xs="24"><el-form-item label="品牌" required><el-select v-model="form.brandId" filterable placeholder="请选择品牌" style="width:100%"><el-option v-for="x in brands" :key="x.id" :label="x.name" :value="x.id" /></el-select></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="分类" required><el-select v-model="form.categoryId" filterable placeholder="请选择分类" style="width:100%"><el-option v-for="x in categories" :key="x.id" :label="x.name" :value="x.id" /></el-select></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="商品名称"><el-input :model-value="displayedName" readonly placeholder="选择品牌和分类后自动生成" /></el-form-item></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="商品编码"><el-input :model-value="displayedCode" readonly placeholder="选择品牌和分类后预览" /></el-form-item></el-col>
          <el-col :span="24"><p class="identity-tip">商品名称由“品牌 + 分类”生成；商品编码由系统保存时正式分配。更换品牌或分类将生成新商品编码。</p></el-col>
          <el-col :span="12" :xs="24"><el-form-item label="副标题"><el-input v-model="form.subtitle" /></el-form-item></el-col>
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
            <el-form-item label="商品主图">
              <div class="product-image-field">
                <div v-if="form.imageUrl" class="product-image-preview">
                  <el-image
                    :src="form.imageUrl"
                    :preview-src-list="[form.imageUrl]"
                    fit="cover"
                    preview-teleported
                  />
                </div>
                <div v-else class="product-image-empty">暂无商品主图</div>

                <div class="product-image-actions">
                  <el-upload
                    accept="image/jpeg,image/png,image/webp"
                    :show-file-list="false"
                    :before-upload="beforeImageUpload"
                    :http-request="handleImageUpload"
                    :disabled="uploadingImage"
                  >
                    <el-button type="primary" plain :loading="uploadingImage">
                      {{ form.imageUrl ? '更换图片' : '选择图片' }}
                    </el-button>
                  </el-upload>
                  <el-button v-if="form.imageUrl" type="danger" plain :disabled="uploadingImage" @click="removeImage">移除图片</el-button>
                </div>
                <p class="product-image-tip">支持 JPG、PNG、WebP，单张不超过 5MB；选择后立即上传。</p>
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
        <el-table-column prop="specText" label="规格" min-width="120" />
        <el-table-column label="售价" width="100"><template #default="{ row }">¥{{ Number(row.basePrice || 0).toFixed(2) }}</template></el-table-column>
        <el-table-column prop="minOrderQty" label="起订量" width="80" />
        <el-table-column label="库存" width="110">
          <template #default="{ row }">
            <el-input-number v-model="row.stockNum" :min="0" size="small" controls-position="right" style="width:90px" @change="(v: number) => updateSku(row.id, { stockNum: v })" />
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80"><template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : 'info'" size="small">{{ row.status === 'active' ? '启用' : '禁用' }}</el-tag></template></el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button link type="primary" @click="editSku(row)">编辑</el-button>
            <el-button link @click="toggleSku(row)">{{ row.status === 'active' ? '禁用' : '启用' }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="skuVisible" :title="sku.id ? '编辑商品规格' : '新建商品规格'" width="480">
      <el-form label-width="90">
        <el-form-item label="编码"><el-input v-model="sku.skuCode" /></el-form-item>
        <el-form-item label="规格名"><el-input v-model="sku.specName" /></el-form-item>
        <el-form-item label="售价"><el-input-number v-model="sku.salePrice" :min="0" :precision="2" style="width:100%" /></el-form-item>
        <el-form-item label="起订量"><el-input-number v-model="sku.minOrderQty" :min="1" /></el-form-item>
        <el-form-item label="库存"><el-input-number v-model="sku.stockNum" :min="0" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="skuVisible = false">取消</el-button><el-button type="primary" @click="saveSku">保存</el-button></template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page-heading, .card-title { display: flex; justify-content: space-between; align-items: center; }
.page-heading { margin-bottom: 20px; }
.card-title { color: var(--brand-text); font-weight: 750; }
.sku-card { margin-top: 18px; }
.product-flag-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); column-gap: 20px; row-gap: 8px; margin-bottom: 18px; }
.product-flag-item { display: grid; grid-template-columns: 100px auto; align-items: center; min-height: 40px; }
.product-flag-item span { padding-right: 12px; color: var(--el-text-color-regular); text-align: right; line-height: 32px; }
.product-image-field { width: 100%; display: flex; flex-direction: column; gap: 12px; }
.product-image-preview, .product-image-empty { width: 168px; height: 168px; overflow: hidden; border: 1px dashed var(--brand-border); }
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
  .product-image-preview, .product-image-empty { width: 140px; height: 140px; }
}
</style>
