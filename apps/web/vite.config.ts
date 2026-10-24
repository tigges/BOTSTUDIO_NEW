import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Read the root package.json version at config time so it's always up to date
const rootPkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as { version: string }
const appVersion = process.env['VITE_APP_VERSION'] ?? rootPkg.version
const buildNumber = process.env['VITE_BUILD_NUMBER'] ?? 'local'
const gitSha     = process.env['VITE_GIT_SHA']     ?? 'dev'
const buildDate  = process.env['VITE_BUILD_DATE']  ?? ''

export default defineConfig({
  // GitHub Pages serves from /<repository name>/; Docker/self-hosted serves from /.
  // Override with VITE_BASE_PATH env var at build time.
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  define: {
    __APP_VERSION__:  JSON.stringify(appVersion),
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
    __GIT_SHA__:      JSON.stringify(gitSha),
    __BUILD_DATE__:   JSON.stringify(buildDate),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        landing: resolve(__dirname, 'landing.html'),
      },
      output: {
        manualChunks: {
          'vendor-router':  ['@tanstack/react-router'],
          'vendor-query':   ['@tanstack/react-query'],
          'vendor-charts':  ['recharts'],
          'vendor-flow':    ['@xyflow/react'],
          'vendor-ui':      ['@botstudio/ui'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
