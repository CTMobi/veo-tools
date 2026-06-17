import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@veo-core': path.resolve(__dirname, 'skills/_shared/veo-core'),
    },
  },
  test: {
    include: ['skills/**/__tests__/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
})
