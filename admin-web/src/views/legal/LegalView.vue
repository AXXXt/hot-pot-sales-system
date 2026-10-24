<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import legal from '../../../../constants/legal.json'
const route = useRoute()
const document = computed(() => route.params.type === 'privacy' ? legal.documents.privacy : legal.documents.terms)
</script>

<template>
  <main class="legal-page">
    <router-link to="/login">返回登录</router-link>
    <h1>{{ document.title }}</h1>
    <p>版本 {{ legal.version }}</p>
    <el-alert :title="legal.notice" type="info" :closable="false" />
    <p>{{ document.intro }}</p>
    <section v-for="section in document.sections" :key="section.title">
      <h2>{{ section.title }}</h2>
      <p v-for="paragraph in section.paragraphs" :key="paragraph">{{ paragraph }}</p>
    </section>
    <a :href="`tel:${legal.phone}`">联系 {{ legal.operator }}：{{ legal.phone }}</a>
  </main>
</template>

<style scoped>
.legal-page { max-width:800px; margin:0 auto; padding:32px 24px 64px; line-height:1.8; overflow-wrap:anywhere; }
h1 { font-size:28px; margin:24px 0 12px; }
h2 { font-size:20px; margin-top:32px; }
</style>
