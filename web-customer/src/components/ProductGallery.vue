<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, ArrowRight, Picture } from '@element-plus/icons-vue'

const props = defineProps<{ images?: string[]; cover?: string; name: string }>()
const images = computed(() => {
  const list = (props.images || []).filter(url => typeof url === 'string' && !!url)
  return [...new Set(list.length ? list : props.cover ? [props.cover] : [])]
})
const viewport = ref<HTMLDivElement>()
const active = ref(0)
const failed = ref<Record<string, boolean>>({})
const previewOpen = ref(false)
const previewImages = computed(() => images.value.filter(url => !failed.value[url]))
const previewIndex = computed(() => Math.max(0, previewImages.value.indexOf(images.value[active.value])))

function go(index: number) {
  const target = Math.max(0, Math.min(index, images.value.length - 1))
  const element = viewport.value
  if (element) element.scrollTo({ left: element.clientWidth * target, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}
function onScroll() {
  const element = viewport.value
  if (element?.clientWidth) active.value = Math.round(element.scrollLeft / element.clientWidth)
}
</script>

<template>
  <section class="product-gallery" aria-label="商品图片">
    <div class="gallery-main">
      <div v-if="!images.length" class="gallery-empty"><el-icon :size="40"><Picture /></el-icon><span>暂无商品图片</span></div>
      <div v-else ref="viewport" class="gallery-viewport" tabindex="0" aria-label="左右滑动查看商品图片" @scroll="onScroll" @keydown.left.prevent="go(active - 1)" @keydown.right.prevent="go(active + 1)">
        <div v-for="(url, index) in images" :key="url" class="gallery-slide" role="group" :aria-label="`第${index + 1}张，共${images.length}张`">
          <div v-if="failed[url]" class="gallery-empty"><el-icon :size="40"><Picture /></el-icon><span>图片加载失败，请查看其他图片</span></div>
          <button v-else class="gallery-preview" :aria-label="`查看第${index + 1}张大图`" @click="active = index; previewOpen = true">
            <img class="cover" :src="url" :alt="`${name}，第${index + 1}张`" @error="failed[url] = true" />
          </button>
        </div>
      </div>
      <template v-if="images.length > 1">
        <button class="gallery-arrow gallery-arrow--previous" aria-label="上一张商品图片" :disabled="active === 0" @click="go(active - 1)"><el-icon><ArrowLeft /></el-icon></button>
        <button class="gallery-arrow gallery-arrow--next" aria-label="下一张商品图片" :disabled="active === images.length - 1" @click="go(active + 1)"><el-icon><ArrowRight /></el-icon></button>
        <span class="gallery-count" aria-live="polite">{{ active + 1 }} / {{ images.length }}</span>
      </template>
    </div>
    <div v-if="images.length > 1" class="gallery-thumbnails" aria-label="选择商品图片">
      <button v-for="(url, index) in images" :key="url" :class="{ active: active === index }" :aria-label="`切换到第${index + 1}张商品图片`" :aria-pressed="active === index" @click="go(index)"><img v-if="!failed[url]" :src="url" alt="" /><el-icon v-else><Picture /></el-icon></button>
    </div>
    <el-image-viewer v-if="previewOpen && previewImages.length" :url-list="previewImages" :initial-index="previewIndex" teleported @close="previewOpen = false" />
  </section>
</template>

<style scoped>
.product-gallery { min-width: 0; }
.gallery-main { position: relative; aspect-ratio: 1; background: var(--soft); }
.gallery-viewport { width: 100%; height: 100%; display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; overscroll-behavior-x: contain; }
.gallery-viewport::-webkit-scrollbar { display: none; }
.gallery-slide { flex: 0 0 100%; min-width: 0; height: 100%; scroll-snap-align: start; }
.gallery-preview { border: 0; padding: 0; background: transparent; width: 100%; height: 100%; cursor: zoom-in; display: block; }
.cover { width: 100%; height: 100%; object-fit: contain; display: block; }
.gallery-empty { width: 100%; height: 100%; display: flex; flex-direction: column; gap: 16px; align-items: center; justify-content: center; color: var(--muted); text-align: center; padding: 20px; box-sizing: border-box; }
.gallery-arrow { position: absolute; top: calc(50% - 22px); width: 44px; height: 44px; border: 1px solid var(--line); border-radius: 50%; background: white; color: var(--green); display: grid; place-items: center; cursor: pointer; }
.gallery-arrow:disabled { opacity: .35; cursor: default; }
.gallery-arrow--previous { left: 10px; }
.gallery-arrow--next { right: 10px; }
.gallery-count { position: absolute; right: 14px; bottom: 14px; background: #263e32; color: white; padding: 5px 12px; border-radius: 16px; font-size: 13px; pointer-events: none; }
.gallery-thumbnails { display: flex; gap: 10px; overflow-x: auto; padding: 12px 2px 2px; }
.gallery-thumbnails button { flex: 0 0 60px; height: 60px; background: var(--soft); border: 2px solid transparent; border-radius: 4px; padding: 2px; cursor: pointer; }
.gallery-thumbnails button.active { border-color: var(--green); }
.gallery-thumbnails img { width: 100%; height: 100%; object-fit: contain; }
button:focus-visible, .gallery-viewport:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
</style>
