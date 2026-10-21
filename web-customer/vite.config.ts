import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig(({ command, mode }) => {
  const api = process.env.VITE_API_BASE_URL ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_API_BASE_URL
  if (command === 'build' && api && api !== '/api/v1' && !api.startsWith('https://')) {
    throw new Error('生产 API 地址必须使用 /api/v1 或 HTTPS，禁止打包本地开发地址')
  }
  return {
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true
  }
  }
})
