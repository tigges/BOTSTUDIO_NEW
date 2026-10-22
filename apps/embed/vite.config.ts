import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'BotStudioWidgetBundle',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    // Keep output small — no external deps
    rollupOptions: {
      external: [],
    },
    minify: true,
    target: 'es2015',
  },
})
