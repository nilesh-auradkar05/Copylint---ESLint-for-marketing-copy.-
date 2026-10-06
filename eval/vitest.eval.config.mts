// Dedicated config for the golden-set eval; the root vitest config does not include eval/**.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: {
    include: ['eval/run-eval.eval.ts'],
    environment: 'node',
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
  },
})
