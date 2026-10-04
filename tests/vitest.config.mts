// Pure fixture UI only: no worker build or app identity needed.
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: { include: ['tests/t010-ui.test.tsx'], environment: 'node' },
})
