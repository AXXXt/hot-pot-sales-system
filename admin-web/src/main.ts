import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/theme.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import { router } from './router'
import { setUnauthorizedHandler } from './api/request'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)

app.use(createPinia()).use(router).use(ElementPlus).mount('#app')

setUnauthorizedHandler(() => {
  useAuthStore().reset()
  void router.replace('/login')
})
