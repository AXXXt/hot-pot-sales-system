import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'
export default defineConfig({ plugins: [vue()], base: '/platform-control/', build: { outDir: 'dist-platform', rollupOptions: { input: resolve(__dirname, 'platform.html') } } })
