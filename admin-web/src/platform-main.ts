import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './styles/theme.css'
import PlatformReleaseCenter from './views/platform/PlatformReleaseCenter.vue'
import { getAccessToken, setUnauthorizedHandler } from './api/request'

const app = createApp(PlatformReleaseCenter).use(ElementPlus)
const login = () => location.assign('/login?redirect=%2Fplatform-updates')
setUnauthorizedHandler(login)
if (!getAccessToken()) login()
else app.mount('#app')
